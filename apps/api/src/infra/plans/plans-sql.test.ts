import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlanDeps } from "../../app/plans";
import { makeListPlans, makeSeedDefaultPlan, type PlanContext } from "../../app/plans";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { makeWithTenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { makeWithPlanUnit } from "./plans-unit";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
const NOW = new Date("2026-11-16T10:00:00.000Z");

let db: TestDatabase;
let source: DataSource;
let deps: PlanDeps;
let counter = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  source = new DataSource({
    ...dataSourceOptions(db.urlFor(APP_ROLE, PASSWORDS.appPassword)),
    extra: { max: 4 },
  });
  await source.initialize();
  deps = {
    withUnit: makeWithPlanUnit(makeWithTenantTx(source), {
      clock: { now: () => NOW },
      ids: { next: () => randomUUID() },
    }),
  };
});

afterAll(async () => {
  await source.destroy();
  await db.drop();
});

async function one(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await db.admin.query(sql, params);
  return (rows[0] as { id: string }).id;
}

async function gym(): Promise<PlanContext> {
  counter += 1;
  const tenantId = await one(
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $1, 'America/Toronto', 'CAD') RETURNING id",
    [`gym-${counter}`],
  );
  return { tenantId, requestId: `req-${counter}` };
}

async function auditOf(tenantId: string) {
  const { rows } = await db.admin.query(
    "SELECT action, entity_id, actor_user_id, before, after FROM audit_events WHERE tenant_id = $1",
    [tenantId],
  );
  return rows as {
    action: string;
    entity_id: string;
    actor_user_id: string | null;
    before: unknown;
    after: unknown;
  }[];
}

describe("seeding the default plan on a real database", () => {
  it("creates the plan and its audit event, and a second run changes nothing", async () => {
    const ctx = await gym();
    const seed = makeSeedDefaultPlan(deps);
    const first = await seed({ admissionFee: 2000, monthlyFee: 5000 }, ctx);
    const second = await seed({ admissionFee: 1, monthlyFee: 1 }, ctx);
    expect(first.ok && first.value.created).toBe(true);
    expect(second.ok && second.value.created).toBe(false);
    expect(second.ok && second.value.plan).toEqual(first.ok && first.value.plan);
    const events = await auditOf(ctx.tenantId);
    expect(events).toEqual([
      {
        action: "plan.created",
        entity_id: first.ok ? first.value.plan.id : "",
        actor_user_id: null,
        before: null,
        after: { key: "default", name: "Default", admissionFee: 2000, monthlyFee: 5000 },
      },
    ]);
  });

  it("gives every gym its own default plan", async () => {
    const [a, b] = [await gym(), await gym()];
    const seed = makeSeedDefaultPlan(deps);
    const [first, second] = [
      await seed({ admissionFee: 100, monthlyFee: 200 }, a),
      await seed({ admissionFee: 300, monthlyFee: 400, name: "Gold" }, b),
    ];
    expect(first.ok && first.value.created).toBe(true);
    expect(second.ok && second.value.created).toBe(true);
    expect(second.ok && second.value.plan.name).toBe("Gold");
  });
});

describe("reading plans on a real database", () => {
  it("lists only the caller's gym, archived plans included, ordered by key", async () => {
    const [mine, theirs] = [await gym(), await gym()];
    await db.admin.query(
      `INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee, is_active) VALUES
         ($1, 'b-new', 'New', 0, 6000, true),
         ($1, 'a-old', 'Old', 0, 4000, false),
         ($2, 'other', 'Other', 0, 1, true)`,
      [mine.tenantId, theirs.tenantId],
    );
    const result = await makeListPlans(deps)(undefined, mine);
    expect(result.ok && result.value.map((plan) => [plan.key, plan.isActive])).toEqual([
      ["a-old", false],
      ["b-new", true],
    ]);
  });

  it("returns nothing for a gym with no plans", async () => {
    const result = await makeListPlans(deps)(undefined, await gym());
    expect(result).toEqual({ ok: true, value: [] });
  });
});

describe("a price change", () => {
  it("never touches invoices that were already generated", async () => {
    const ctx = await gym();
    const seeded = await makeSeedDefaultPlan(deps)({ admissionFee: 2000, monthlyFee: 5000 }, ctx);
    const planId = seeded.ok ? seeded.value.plan.id : "";
    counter += 1;
    const userId = await one("INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id", [
      ctx.tenantId,
      `m${counter}@example.test`,
    ]);
    const memberId = await one(
      `INSERT INTO members (tenant_id, user_id, member_no, barcode, billing_day)
       VALUES ($1, $2, $3, $4, 15) RETURNING id`,
      [ctx.tenantId, userId, `P${String(counter).padStart(5, "0")}`, randomUUID()],
    );
    await db.admin.query(
      `INSERT INTO membership_periods (tenant_id, member_id, plan_id, status, valid_from)
       VALUES ($1, $2, $3, 'active', '2026-11-15')`,
      [ctx.tenantId, memberId, planId],
    );
    const invoiceId = await one(
      `INSERT INTO invoices (tenant_id, member_id, period_start, period_end, due_date, total)
       VALUES ($1, $2, '2026-11-15', '2026-12-14', '2026-11-15', 7000) RETURNING id`,
      [ctx.tenantId, memberId],
    );
    await db.admin.query(
      "UPDATE plans SET admission_fee = 9000, monthly_fee = 9500, is_active = false WHERE id = $1",
      [planId],
    );
    const { rows } = await db.admin.query("SELECT total FROM invoices WHERE id = $1", [invoiceId]);
    expect((rows[0] as { total: number }).total).toBe(7000);
    const listed = await makeListPlans(deps)(undefined, ctx);
    expect(listed.ok && listed.value[0]).toMatchObject({ monthlyFee: 9500, isActive: false });
  });
});
