import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeRequestLoaders } from "../../api/loaders";
import { makeListMembers } from "../../app/member-queries";
import type { LoaderUnit, MemberQueryUnit, WithTenantTx } from "../../app/ports";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import type { SqlExecutor } from "../db/sql-executor";
import { makeWithTenantTx, type TenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { makeTxExecutor } from "../db/tx-executor";
import { makePlanStore } from "../plans/plans-sql";
import { makeTenantStore } from "../tenants/tenant-sql";
import { makeWithLoaderUnit } from "./loader-unit";
import { makeMemberQueryStore } from "./member-queries-sql";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
const NOW = new Date("2026-11-16T15:00:00.000Z");
const CLOCK = { now: () => NOW };

let db: TestDatabase;
let source: DataSource;
let withTenantTx: WithTenantTx<TenantTx>;
let withLoaderUnit: WithTenantTx<LoaderUnit>;
let counter = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  source = new DataSource({
    ...dataSourceOptions(db.urlFor(APP_ROLE, PASSWORDS.appPassword)),
    extra: { max: 6 },
  });
  await source.initialize();
  withTenantTx = makeWithTenantTx(source);
  withLoaderUnit = makeWithLoaderUnit(withTenantTx);
});

afterAll(async () => {
  await source.destroy();
  await db.drop();
});

async function one(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await db.admin.query(sql, params);
  return (rows[0] as { id: string }).id;
}

interface Gym {
  readonly tenantId: string;
  readonly planId: string;
}

async function gym(): Promise<Gym> {
  counter += 1;
  const tenantId = await one(
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $1, 'America/Toronto', 'CAD') RETURNING id",
    [`loader-gym-${counter}`],
  );
  const planId = await one(
    "INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee) VALUES ($1, 'default', 'Default', 2000, 5000) RETURNING id",
    [tenantId],
  );
  return { tenantId, planId };
}

async function addMembers(g: Gym, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    counter += 1;
    const userId = await one(
      "INSERT INTO users (tenant_id, email, name) VALUES ($1, $2, $3) RETURNING id",
      [g.tenantId, `m-${counter}@example.test`, `Member ${counter}`],
    );
    const memberId = await one(
      "INSERT INTO members (tenant_id, user_id, member_no, barcode, billing_day) VALUES ($1, $2, $3, $4, 1) RETURNING id",
      [
        g.tenantId,
        userId,
        `Q${String(counter).padStart(5, "0")}`,
        `R${String(counter).padStart(5, "0")}`,
      ],
    );
    await db.admin.query(
      "INSERT INTO membership_periods (tenant_id, member_id, plan_id, status, valid_from) VALUES ($1, $2, $3, 'active', '2026-01-01')",
      [g.tenantId, memberId, g.planId],
    );
    ids.push(memberId);
  }
  return ids;
}

/** Runs units like the real ones, but counts every statement the stores send. */
function counting() {
  const statements = { count: 0 };
  const executorOf = (tx: TenantTx): SqlExecutor => {
    const real = makeTxExecutor(tx);
    return {
      query: (sql, params) => {
        statements.count += 1;
        return real.query(sql, params);
      },
    };
  };
  const withLoaders: WithTenantTx<LoaderUnit> = (tenantId, fn) =>
    withTenantTx(tenantId, (tx) => {
      const executor = executorOf(tx);
      return fn({
        members: makeMemberQueryStore(executor, tenantId),
        plans: makePlanStore(executor, tenantId),
        tenants: makeTenantStore(executor, tenantId),
      });
    });
  const withMemberQueries: WithTenantTx<MemberQueryUnit> = (tenantId, fn) =>
    withTenantTx(tenantId, (tx) => {
      const executor = executorOf(tx);
      return fn({
        members: makeMemberQueryStore(executor, tenantId),
        tenants: makeTenantStore(executor, tenantId),
      });
    });
  return { statements, withLoaders, withMemberQueries };
}

describe("per request loaders against Postgres", () => {
  it("loads members, plans and standing, with null for an id nobody holds", async () => {
    const g = await gym();
    const [first, second] = await addMembers(g, 2);
    const loaders = makeRequestLoaders({ withUnit: withLoaderUnit, clock: CLOCK }, g.tenantId);
    const [a, b, none, plan, planNone] = await Promise.all([
      loaders.member.load(first as string),
      loaders.member.load(second as string),
      loaders.member.load(randomUUID()),
      loaders.plan.load(g.planId),
      loaders.plan.load(randomUUID()),
    ]);
    expect([a?.id, b?.id, none]).toEqual([first, second, null]);
    expect(a?.plan.id).toBe(g.planId);
    expect(plan).toMatchObject({ id: g.planId, key: "default", monthlyFee: 5000 });
    expect(planNone).toBeNull();
    expect(await loaders.standing(first as string)).toBe(a?.standing);
  });

  it("never reads another gym's members or plans", async () => {
    const mine = await gym();
    const theirs = await gym();
    const [theirMember] = await addMembers(theirs, 1);
    const loaders = makeRequestLoaders({ withUnit: withLoaderUnit, clock: CLOCK }, mine.tenantId);
    expect(await loaders.member.load(theirMember as string)).toBeNull();
    expect(await loaders.plan.load(theirs.planId)).toBeNull();
    expect(await loaders.standing(theirMember as string)).toBeNull();
  });

  it("issues the same number of statements for 3 members as for 60", async () => {
    const g = await gym();
    const ids = await addMembers(g, 60);
    const small = counting();
    const smallLoaders = makeRequestLoaders(
      { withUnit: small.withLoaders, clock: CLOCK },
      g.tenantId,
    );
    await Promise.all(ids.slice(0, 3).map((id) => smallLoaders.member.load(id)));
    const large = counting();
    const largeLoaders = makeRequestLoaders(
      { withUnit: large.withLoaders, clock: CLOCK },
      g.tenantId,
    );
    const loaded = await Promise.all(ids.map((id) => largeLoaders.member.load(id)));
    expect(loaded.every((member) => member !== null)).toBe(true);
    expect(small.statements.count).toBe(2);
    expect(large.statements.count).toBe(2);
  });
});

describe("the member list against Postgres", () => {
  it("issues the same number of statements for a page of 5 as for a page of 50", async () => {
    const g = await gym();
    await addMembers(g, 60);
    const counts: number[] = [];
    for (const limit of [5, 50]) {
      const run = counting();
      const list = makeListMembers({ withUnit: run.withMemberQueries, clock: CLOCK });
      const page = await list({ limit }, { roles: ["staff"], tenantId: g.tenantId });
      expect(page.ok && page.value.items).toHaveLength(limit);
      counts.push(run.statements.count);
    }
    expect(counts).toEqual([2, 2]);
  });
});

describe("the batch store methods", () => {
  it("answer an empty list of ids without a statement", async () => {
    const g = await gym();
    const run = counting();
    const result = await run.withLoaders(g.tenantId, async (unit) => [
      await unit.members.findMany([], {
        today: "2026-11-16",
        warnDaysBefore: 5,
        redDaysAfter: 5,
        lastMonthStart: "2026-10-01",
        thisMonthStart: "2026-11-01",
        nextMonthStart: "2026-12-01",
      }),
    ]);
    expect(result).toEqual([[]]);
    expect(run.statements.count).toBe(0);
  });
});
