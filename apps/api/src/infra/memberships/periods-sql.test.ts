import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ChangeMembershipContext,
  makeCancelMember,
  makePauseMember,
  makeResumeMember,
} from "../../app/change-membership";
import type { MembershipUnit, WithTenantTx } from "../../app/ports";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { makeWithTenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { makeWithMembershipUnit } from "./memberships-unit";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
const NOW = new Date("2026-11-16T15:00:00.000Z");
const CLOCK = { now: () => NOW };

let db: TestDatabase;
let source: DataSource;
let withUnit: WithTenantTx<MembershipUnit>;
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
  withUnit = makeWithMembershipUnit(makeWithTenantTx(source), {
    clock: CLOCK,
    ids: { next: randomUUID },
  });
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
  ctx: ChangeMembershipContext;
  memberId: string;
}

async function gym(roles: ChangeMembershipContext["roles"] = ["owner"]): Promise<Gym> {
  counter += 1;
  const tenantId = await one(
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $1, 'America/Toronto', 'CAD') RETURNING id",
    [`gym-${counter}`],
  );
  const userId = await one("INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id", [
    tenantId,
    `owner-${counter}@example.test`,
  ]);
  const memberUserId = await one(
    "INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id",
    [tenantId, `member-${counter}@example.test`],
  );
  const planId = await one(
    "INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee) VALUES ($1, 'default', 'Default', 2000, 5000) RETURNING id",
    [tenantId],
  );
  const memberId = await one(
    "INSERT INTO members (tenant_id, user_id, member_no, barcode, billing_day) VALUES ($1, $2, $3, $4, 1) RETURNING id",
    [
      tenantId,
      memberUserId,
      `M${String(counter).padStart(5, "0")}`,
      `B${String(counter).padStart(5, "0")}`,
    ],
  );
  await db.admin.query(
    "INSERT INTO membership_periods (tenant_id, member_id, plan_id, status, valid_from) VALUES ($1, $2, $3, 'active', '2026-11-01')",
    [tenantId, memberId, planId],
  );
  return { ctx: { roles, tenantId, userId, requestId: `req-${counter}` }, memberId };
}

const deps = () => ({ withUnit, clock: CLOCK });

async function periodsOf(g: Gym) {
  const { rows } = await db.admin.query(
    `SELECT status, to_char(valid_from, 'YYYY-MM-DD') AS valid_from,
            to_char(valid_to, 'YYYY-MM-DD') AS valid_to, reason, changed_by
       FROM membership_periods WHERE tenant_id = $1 AND member_id = $2 ORDER BY created_at, valid_from`,
    [g.ctx.tenantId, g.memberId],
  );
  return rows as {
    status: string;
    valid_from: string;
    valid_to: string | null;
    reason: string | null;
    changed_by: string | null;
  }[];
}

async function currentCount(g: Gym): Promise<number> {
  const { rows } = await db.admin.query(
    "SELECT count(*)::int AS n FROM membership_periods WHERE tenant_id = $1 AND member_id = $2 AND valid_to IS NULL",
    [g.ctx.tenantId, g.memberId],
  );
  return (rows[0] as { n: number }).n;
}

describe("pause, resume and cancel on a real database", () => {
  it("walks a membership through pause, resume and cancel with touching periods", async () => {
    const g = await gym();
    const input = { memberId: g.memberId, reason: "Holiday" };
    expect((await makePauseMember(deps())(input, g.ctx)).ok).toBe(true);
    expect((await makeResumeMember(deps())(input, g.ctx)).ok).toBe(true);
    expect((await makeCancelMember(deps())({ ...input, reason: "Moved" }, g.ctx)).ok).toBe(true);

    expect(await periodsOf(g)).toEqual([
      {
        status: "active",
        valid_from: "2026-11-01",
        valid_to: "2026-11-16",
        reason: null,
        changed_by: null,
      },
      {
        status: "paused",
        valid_from: "2026-11-16",
        valid_to: "2026-11-16",
        reason: "Holiday",
        changed_by: g.ctx.userId,
      },
      {
        status: "active",
        valid_from: "2026-11-16",
        valid_to: "2026-11-16",
        reason: "Holiday",
        changed_by: g.ctx.userId,
      },
      {
        status: "cancelled",
        valid_from: "2026-11-16",
        valid_to: null,
        reason: "Moved",
        changed_by: g.ctx.userId,
      },
    ]);
    expect(await currentCount(g)).toBe(1);
    const audit = await db.admin.query(
      "SELECT action FROM audit_events WHERE tenant_id = $1 ORDER BY action",
      [g.ctx.tenantId],
    );
    expect(audit.rows).toEqual([
      { action: "member.cancelled" },
      { action: "member.paused" },
      { action: "member.resumed" },
    ]);
  });

  it("leaves exactly one current row when a pause and a cancel arrive together", async () => {
    const g = await gym();
    const input = { memberId: g.memberId, reason: "Race" };
    const results = await Promise.all([
      makePauseMember(deps())(input, g.ctx),
      makeCancelMember(deps())(input, g.ctx),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await currentCount(g)).toBe(1);
    const periods = await periodsOf(g);
    expect(periods.filter((p) => p.valid_to === null)).toHaveLength(1);
    expect(periods.at(-1)?.status).toBe("cancelled");
  });

  it("lets only one of two simultaneous pauses through", async () => {
    const g = await gym();
    const input = { memberId: g.memberId, reason: "Race" };
    const results = await Promise.all([
      makePauseMember(deps())(input, g.ctx),
      makePauseMember(deps())(input, g.ctx),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(await currentCount(g)).toBe(1);
  });

  it("rolls the periods back when the audit event cannot be written", async () => {
    const g = await gym();
    const broken = makeWithMembershipUnit(makeWithTenantTx(source), {
      clock: CLOCK,
      ids: { next: () => "not-a-uuid" },
    });
    await expect(
      makePauseMember({ withUnit: broken, clock: CLOCK })(
        { memberId: g.memberId, reason: "x" },
        g.ctx,
      ),
    ).rejects.toThrow();
    expect(await periodsOf(g)).toEqual([
      {
        status: "active",
        valid_from: "2026-11-01",
        valid_to: null,
        reason: null,
        changed_by: null,
      },
    ]);
  });

  it("treats a member with no current period as a bug", async () => {
    const g = await gym();
    await db.admin.query("DELETE FROM membership_periods WHERE tenant_id = $1", [g.ctx.tenantId]);
    await expect(
      makePauseMember(deps())({ memberId: g.memberId, reason: "x" }, g.ctx),
    ).rejects.toThrow("A member has no current membership period");
  });

  it("never lets another gym see or change the member", async () => {
    const a = await gym();
    const b = await gym();
    const result = await makeCancelMember(deps())(
      { memberId: a.memberId, reason: "Hostile" },
      b.ctx,
    );
    expect(!result.ok && result.error.kind).toBe("not_found");
    expect((await periodsOf(a))[0]?.status).toBe("active");
    expect(await currentCount(a)).toBe(1);
  });
});

describe("the database refuses overlapping periods", () => {
  it("rejects a second current row", async () => {
    const g = await gym();
    await expect(
      db.admin.query(
        `INSERT INTO membership_periods (tenant_id, member_id, plan_id, status, valid_from)
         SELECT tenant_id, member_id, plan_id, 'paused', '2026-12-01' FROM membership_periods
          WHERE tenant_id = $1 AND member_id = $2`,
        [g.ctx.tenantId, g.memberId],
      ),
    ).rejects.toThrow();
  });

  it("rejects a period that overlaps a closed one", async () => {
    const g = await gym();
    await makePauseMember(deps())({ memberId: g.memberId, reason: "x" }, g.ctx);
    await expect(
      db.admin.query(
        `INSERT INTO membership_periods (tenant_id, member_id, plan_id, status, valid_from, valid_to)
         SELECT tenant_id, member_id, plan_id, 'paused', '2026-11-05', '2026-11-10' FROM membership_periods
          WHERE tenant_id = $1 AND member_id = $2 LIMIT 1`,
        [g.ctx.tenantId, g.memberId],
      ),
    ).rejects.toThrow(/membership_periods_no_overlap/);
  });
});
