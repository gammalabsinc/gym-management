import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  makeGetTenant,
  makeUpdatePlan,
  makeUpdateSettings,
  type SettingsContext,
  type SettingsDeps,
} from "../../app/tenant-settings";
import type { Role } from "../../domain/permissions";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { makeWithTenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { makeWithSettingsUnit } from "./settings-unit";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
const NOW = new Date("2026-11-16T10:00:00.000Z");

let db: TestDatabase;
let source: DataSource;
let deps: SettingsDeps;
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
    withUnit: makeWithSettingsUnit(makeWithTenantTx(source), {
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

interface Gym {
  tenantId: string;
  ownerId: string;
  planId: string;
}

async function gym(extraSettings: Record<string, unknown> = {}): Promise<Gym> {
  counter += 1;
  const tenantId = await one(
    `INSERT INTO tenants (name, subdomain, timezone, currency, branding, settings)
     VALUES ($1, $1, 'America/Toronto', 'CAD', $2::jsonb,
             '{"warn_days_before": 5, "red_days_after": 5, "dup_window_min": 10}'::jsonb || $3::jsonb)
     RETURNING id`,
    [
      `gym-${counter}`,
      JSON.stringify({
        logo_url: "https://x.test/logo.png",
        primary_color: "#112233",
        contact: { phone: "555-0100", email: "desk@x.test", address: "1 Main St" },
      }),
      JSON.stringify(extraSettings),
    ],
  );
  const ownerId = await one("INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id", [
    tenantId,
    `owner${counter}@example.test`,
  ]);
  const planId = await one(
    "INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee) VALUES ($1, 'default', 'Default', 2000, 5000) RETURNING id",
    [tenantId],
  );
  return { tenantId, ownerId, planId };
}

function ctx(g: Gym, roles: Role[]): SettingsContext {
  return { roles, tenantId: g.tenantId, userId: g.ownerId, requestId: "req-sql" };
}

async function settingsOf(tenantId: string): Promise<Record<string, unknown>> {
  const { rows } = await db.admin.query("SELECT settings FROM tenants WHERE id = $1", [tenantId]);
  return (rows[0] as { settings: Record<string, unknown> }).settings;
}

async function auditOf(tenantId: string) {
  const { rows } = await db.admin.query(
    "SELECT action, entity_type, entity_id, actor_user_id, before, after FROM audit_events WHERE tenant_id = $1",
    [tenantId],
  );
  return rows as {
    action: string;
    entity_type: string;
    entity_id: string;
    actor_user_id: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }[];
}

describe("reading the gym profile", () => {
  it("gives staff the full profile with defaults filled in for unset referral settings", async () => {
    const g = await gym();
    const result = await makeGetTenant(deps)(undefined, ctx(g, ["staff"]));
    expect(result.ok && result.value).toEqual({
      kind: "full",
      tenant: {
        id: g.tenantId,
        name: expect.stringContaining("gym-"),
        subdomain: expect.stringContaining("gym-"),
        timezone: "America/Toronto",
        currency: "CAD",
        branding: {
          logoUrl: "https://x.test/logo.png",
          primaryColor: "#112233",
          contactPhone: "555-0100",
          contactEmail: "desk@x.test",
          contactAddress: "1 Main St",
        },
        settings: {
          warnDaysBefore: 5,
          redDaysAfter: 5,
          dupWindowMin: 10,
          referrerAmount: 0,
          referrerIsRecurring: false,
          referredAmount: 0,
          referredIsRecurring: false,
        },
      },
    });
  });

  it("gives a member the name, colour and contacts of their own gym only", async () => {
    const [mine, theirs] = [await gym(), await gym()];
    const result = await makeGetTenant(deps)(undefined, ctx(mine, ["member"]));
    expect(result.ok && result.value.kind).toBe("member");
    expect(result.ok && result.value.tenant.id).toBe(mine.tenantId);
    expect(JSON.stringify(result)).not.toContain(theirs.tenantId);
    expect(JSON.stringify(result)).not.toContain("settings");
  });

  it("answers not found when the gym id has no row", async () => {
    const g = await gym();
    const result = await makeGetTenant(deps)(undefined, {
      ...ctx(g, ["owner"]),
      tenantId: randomUUID(),
    });
    expect(!result.ok && result.error.kind).toBe("not_found");
  });
});

describe("updating settings on a real database", () => {
  it("merges the change, keeps other keys, audits old and new, and leaves other gyms alone", async () => {
    const [mine, theirs] = [await gym({ custom_flag: "keep-me" }), await gym()];
    const result = await makeUpdateSettings(deps)(
      { warnDaysBefore: 7, referrerAmount: 500, referrerIsRecurring: true },
      ctx(mine, ["owner"]),
    );
    expect(result.ok && result.value.settings.warnDaysBefore).toBe(7);
    expect(await settingsOf(mine.tenantId)).toEqual({
      warn_days_before: 7,
      red_days_after: 5,
      dup_window_min: 10,
      referrer_amount: 500,
      referrer_is_recurring: true,
      custom_flag: "keep-me",
    });
    expect(await settingsOf(theirs.tenantId)).toEqual({
      warn_days_before: 5,
      red_days_after: 5,
      dup_window_min: 10,
    });
    expect(await auditOf(mine.tenantId)).toEqual([
      {
        action: "settings.updated",
        entity_type: "tenant",
        entity_id: mine.tenantId,
        actor_user_id: mine.ownerId,
        before: { warnDaysBefore: 5, referrerAmount: 0, referrerIsRecurring: false },
        after: { warnDaysBefore: 7, referrerAmount: 500, referrerIsRecurring: true },
      },
    ]);
    expect(await auditOf(theirs.tenantId)).toEqual([]);
  });

  it("does not let a staff member or a member change settings", async () => {
    const g = await gym();
    for (const roles of [["staff"], ["member"]] as Role[][]) {
      const result = await makeUpdateSettings(deps)({ warnDaysBefore: 1 }, ctx(g, roles));
      expect(!result.ok && result.error.kind).toBe("forbidden");
    }
    expect((await settingsOf(g.tenantId)).warn_days_before).toBe(5);
    expect(await auditOf(g.tenantId)).toEqual([]);
  });

  it("keeps both changes when two owners edit different settings at the same moment", async () => {
    const g = await gym();
    const [a, b] = await Promise.all([
      makeUpdateSettings(deps)({ warnDaysBefore: 8 }, ctx(g, ["owner"])),
      makeUpdateSettings(deps)({ redDaysAfter: 9 }, ctx(g, ["owner"])),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(await settingsOf(g.tenantId)).toMatchObject({ warn_days_before: 8, red_days_after: 9 });
    const events = await auditOf(g.tenantId);
    expect(events).toHaveLength(2);
  });

  it("answers not found when the gym id has no row", async () => {
    const g = await gym();
    const result = await makeUpdateSettings(deps)(
      { warnDaysBefore: 3 },
      { ...ctx(g, ["owner"]), tenantId: randomUUID() },
    );
    expect(!result.ok && result.error.kind).toBe("not_found");
  });
});

describe("updating a plan on a real database", () => {
  it("changes the fees and audits it, and never touches an invoice that already exists", async () => {
    const g = await gym();
    counter += 1;
    const userId = await one("INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id", [
      g.tenantId,
      `m${counter}@example.test`,
    ]);
    const memberId = await one(
      `INSERT INTO members (tenant_id, user_id, member_no, barcode, billing_day)
       VALUES ($1, $2, $3, $4, 15) RETURNING id`,
      [g.tenantId, userId, `T${String(counter).padStart(5, "0")}`, randomUUID()],
    );
    await db.admin.query(
      `INSERT INTO membership_periods (tenant_id, member_id, plan_id, status, valid_from)
       VALUES ($1, $2, $3, 'active', '2026-11-15')`,
      [g.tenantId, memberId, g.planId],
    );
    const invoiceId = await one(
      `INSERT INTO invoices (tenant_id, member_id, period_start, period_end, due_date, total)
       VALUES ($1, $2, '2026-11-15', '2026-12-14', '2026-11-15', 7000) RETURNING id`,
      [g.tenantId, memberId],
    );
    await db.admin.query(
      `INSERT INTO invoice_lines (tenant_id, invoice_id, line_type, description, amount)
       VALUES ($1, $2, 'membership', 'Monthly', 5000), ($1, $2, 'admission', 'Admission', 2000)`,
      [g.tenantId, invoiceId],
    );
    const result = await makeUpdatePlan(deps)(
      { planId: g.planId, name: "Default", admissionFee: 3000, monthlyFee: 6500 },
      ctx(g, ["owner"]),
    );
    expect(result.ok && result.value).toMatchObject({ admissionFee: 3000, monthlyFee: 6500 });
    const plan = await db.admin.query(
      "SELECT admission_fee, monthly_fee FROM plans WHERE id = $1",
      [g.planId],
    );
    expect(plan.rows[0]).toEqual({ admission_fee: 3000, monthly_fee: 6500 });
    const invoice = await db.admin.query("SELECT total FROM invoices WHERE id = $1", [invoiceId]);
    expect(invoice.rows[0]).toEqual({ total: 7000 });
    const lines = await db.admin.query(
      "SELECT amount FROM invoice_lines WHERE invoice_id = $1 ORDER BY amount",
      [invoiceId],
    );
    expect(lines.rows).toEqual([{ amount: 2000 }, { amount: 5000 }]);
    expect(await auditOf(g.tenantId)).toEqual([
      {
        action: "plan.updated",
        entity_type: "plan",
        entity_id: g.planId,
        actor_user_id: g.ownerId,
        before: { name: "Default", admissionFee: 2000, monthlyFee: 5000 },
        after: { name: "Default", admissionFee: 3000, monthlyFee: 6500 },
      },
    ]);
  });

  it("cannot edit a plan that belongs to another gym", async () => {
    const [mine, theirs] = [await gym(), await gym()];
    const result = await makeUpdatePlan(deps)(
      { planId: theirs.planId, name: "Hijack", admissionFee: 0, monthlyFee: 0 },
      ctx(mine, ["owner"]),
    );
    expect(!result.ok && result.error.kind).toBe("not_found");
    const { rows } = await db.admin.query("SELECT name, monthly_fee FROM plans WHERE id = $1", [
      theirs.planId,
    ]);
    expect(rows[0]).toEqual({ name: "Default", monthly_fee: 5000 });
  });
});
