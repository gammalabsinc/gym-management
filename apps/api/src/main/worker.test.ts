import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LogFields, Logger } from "../app/ports";
import { migrateDatabase } from "../infra/db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../infra/db/roles";
import { createTestDatabase, type TestDatabase } from "../infra/db/test-database";
import { runInvoiceTopUp } from "./worker";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };

let db: TestDatabase;
let url: string;
let counter = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  url = db.urlFor(APP_ROLE, PASSWORDS.appPassword);
});

afterAll(async () => {
  await db.drop();
});

interface Line {
  level: string;
  message: string;
  fields: LogFields;
}

function recorder() {
  const lines: Line[] = [];
  const logger: Logger = {
    debug: () => {},
    info: (message, fields = {}) => void lines.push({ level: "info", message, fields }),
    warn: () => {},
    error: (message, fields = {}) => void lines.push({ level: "error", message, fields }),
    child: () => logger,
  };
  return { logger, lines };
}

async function one(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await db.admin.query(sql, params);
  return (rows[0] as { id: string }).id;
}

/** A gym with one member whose billing day is today's day of the month plus `inDays`. */
async function gymWithMember(options: { status?: string; isActive?: boolean } = {}) {
  counter += 1;
  const tenantId = await one(
    `INSERT INTO tenants (name, subdomain, timezone, currency, is_active)
     VALUES ($1, $1, 'America/Toronto', 'CAD', $2) RETURNING id`,
    [`gym-${counter}`, options.isActive ?? true],
  );
  const planId = await one(
    "INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee) VALUES ($1, 'default', 'Default', 2000, 5000) RETURNING id",
    [tenantId],
  );
  const userId = await one("INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id", [
    tenantId,
    `member-${counter}@example.test`,
  ]);
  // Joined long enough ago that exactly one more cycle is due, starting in about two days.
  const start = await one(
    "SELECT to_char((now() AT TIME ZONE 'America/Toronto')::date - 28, 'YYYY-MM-DD') AS id",
    [],
  );
  const billingDay = Number(start.slice(8, 10));
  const memberId = await one(
    `INSERT INTO members (tenant_id, user_id, member_no, barcode, billing_day)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, userId, `M${String(counter).padStart(5, "0")}`, randomUUID(), billingDay],
  );
  await db.admin.query(
    `INSERT INTO membership_periods (tenant_id, member_id, plan_id, status, valid_from)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, memberId, planId, options.status ?? "active", start],
  );
  return { tenantId, memberId };
}

async function invoiceCount(tenantId: string): Promise<number> {
  const { rows } = await db.admin.query(
    "SELECT count(*)::int AS n FROM invoices WHERE tenant_id = $1",
    [tenantId],
  );
  return (rows[0] as { n: number }).n;
}

describe("the worker against a real database", () => {
  it("tops up the active members of every active gym, once, and builds nothing on a second run", async () => {
    const a = await gymWithMember();
    const b = await gymWithMember();
    const paused = await gymWithMember({ status: "paused" });
    const off = await gymWithMember({ isActive: false });
    const { logger } = recorder();

    const first = await runInvoiceTopUp(url, logger);
    expect(first.failedTenants).toBe(0);
    expect(first.failedMembers).toBe(0);
    expect(first.invoices).toBeGreaterThanOrEqual(2);
    expect(await invoiceCount(a.tenantId)).toBeGreaterThan(0);
    expect(await invoiceCount(b.tenantId)).toBeGreaterThan(0);
    expect(await invoiceCount(paused.tenantId)).toBe(0);
    expect(await invoiceCount(off.tenantId)).toBe(0);

    const before = await invoiceCount(a.tenantId);
    const second = await runInvoiceTopUp(url, logger);
    expect(second.invoices).toBe(0);
    expect(await invoiceCount(a.tenantId)).toBe(before);
  });

  it("leaves a gym alone while another worker holds its lock", async () => {
    const gym = await gymWithMember();
    const holder = new (await import("pg")).default.Client({ connectionString: url });
    await holder.connect();
    try {
      await holder.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
        `gym:invoice-top-up:${gym.tenantId}`,
      ]);
      const { logger } = recorder();
      const summary = await runInvoiceTopUp(url, logger);
      expect(summary.skippedTenants).toBeGreaterThanOrEqual(1);
      expect(await invoiceCount(gym.tenantId)).toBe(0);
    } finally {
      await holder.end();
    }
    const { logger } = recorder();
    await runInvoiceTopUp(url, logger);
    expect(await invoiceCount(gym.tenantId)).toBeGreaterThan(0);
  });
});
