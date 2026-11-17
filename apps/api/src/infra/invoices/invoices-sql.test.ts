import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type InvoiceContext, type InvoiceDeps, makeGenerateInvoices } from "../../app/invoices";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { makeWithTenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { makeWithInvoiceUnit } from "./invoices-unit";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
/** 10:00 UTC on 16 November is the morning of 16 November in Toronto. */
const NOW = new Date("2026-11-16T15:00:00.000Z");

let db: TestDatabase;
let source: DataSource;
let deps: InvoiceDeps;
let counter = 0;

function depsWithIds(next: () => string): InvoiceDeps {
  return {
    clock: { now: () => NOW },
    withUnit: makeWithInvoiceUnit(makeWithTenantTx(source), {
      clock: { now: () => NOW },
      ids: { next },
    }),
  };
}

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  source = new DataSource({
    ...dataSourceOptions(db.urlFor(APP_ROLE, PASSWORDS.appPassword)),
    extra: { max: 6 },
  });
  await source.initialize();
  deps = depsWithIds(randomUUID);
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
  ctx: InvoiceContext;
  userId: string;
  planId: string;
}

async function gym(): Promise<Gym> {
  counter += 1;
  const tenantId = await one(
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $1, 'America/Toronto', 'CAD') RETURNING id",
    [`gym-${counter}`],
  );
  const userId = await one("INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id", [
    tenantId,
    `staff-${counter}@example.test`,
  ]);
  const planId = await one(
    "INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee) VALUES ($1, 'default', 'Default', 2000, 5000) RETURNING id",
    [tenantId],
  );
  return { ctx: { tenantId, actorUserId: userId, requestId: `req-${counter}` }, userId, planId };
}

async function member(g: Gym, status = "active", validFrom = "2026-11-15"): Promise<string> {
  counter += 1;
  const userId = await one("INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id", [
    g.ctx.tenantId,
    `member-${counter}@example.test`,
  ]);
  const memberId = await one(
    `INSERT INTO members (tenant_id, user_id, member_no, barcode, billing_day)
     VALUES ($1, $2, $3, $4, 15) RETURNING id`,
    [g.ctx.tenantId, userId, `M${String(counter).padStart(5, "0")}`, randomUUID()],
  );
  await db.admin.query(
    `INSERT INTO membership_periods (tenant_id, member_id, plan_id, status, valid_from)
     VALUES ($1, $2, $3, $4, $5)`,
    [g.ctx.tenantId, memberId, g.planId, status, validFrom],
  );
  return memberId;
}

async function addDiscount(
  g: Gym,
  memberId: string,
  amount: number,
  isRecurring: boolean,
): Promise<string> {
  return one(
    `INSERT INTO member_discounts (tenant_id, member_id, kind, reason, amount, is_recurring, starts_on)
     VALUES ($1, $2, 'manual', 'test', $3, $4, '2026-01-01') RETURNING id`,
    [g.ctx.tenantId, memberId, amount, isRecurring],
  );
}

interface InvoiceRow {
  id: string;
  period_start: string;
  period_end: string;
  due_date: string;
  total: number;
}

async function invoicesOf(memberId: string): Promise<InvoiceRow[]> {
  const { rows } = await db.admin.query(
    `SELECT id, to_char(period_start, 'YYYY-MM-DD') AS period_start,
            to_char(period_end, 'YYYY-MM-DD') AS period_end,
            to_char(due_date, 'YYYY-MM-DD') AS due_date, total
       FROM invoices WHERE member_id = $1 ORDER BY period_start`,
    [memberId],
  );
  return rows as InvoiceRow[];
}

async function linesOf(invoiceId: string): Promise<[string, number][]> {
  const { rows } = await db.admin.query(
    "SELECT line_type, amount FROM invoice_lines WHERE invoice_id = $1 ORDER BY line_type",
    [invoiceId],
  );
  return (rows as { line_type: string; amount: number }[]).map((r) => [r.line_type, r.amount]);
}

async function auditCount(tenantId: string): Promise<number> {
  const { rows } = await db.admin.query(
    "SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = 'invoice.generated'",
    [tenantId],
  );
  return (rows[0] as { n: number }).n;
}

describe("generating invoices on a real database", () => {
  it("builds the cycles with their lines, and running it twice creates nothing new", async () => {
    const g = await gym();
    const memberId = await member(g);
    await addDiscount(g, memberId, 1000, true);
    const generate = makeGenerateInvoices(deps);

    const first = await generate({ memberId, ahead: 2 }, g.ctx);
    expect(first.ok && first.value.invoices).toHaveLength(3);
    const rows = await invoicesOf(memberId);
    expect(rows.map((r) => [r.period_start, r.period_end, r.due_date, r.total])).toEqual([
      ["2026-11-15", "2026-12-14", "2026-11-15", 6000],
      ["2026-12-15", "2027-01-14", "2026-12-15", 4000],
      ["2027-01-15", "2027-02-14", "2027-01-15", 4000],
    ]);
    const [firstInvoice, secondInvoice] = rows;
    expect(await linesOf(firstInvoice?.id ?? "")).toEqual([
      ["admission", 2000],
      ["discount", -1000],
      ["membership", 5000],
    ]);
    expect(await linesOf(secondInvoice?.id ?? "")).toEqual([
      ["discount", -1000],
      ["membership", 5000],
    ]);
    expect(await auditCount(g.ctx.tenantId)).toBe(3);

    const second = await generate({ memberId, ahead: 2 }, g.ctx);
    expect(second.ok && second.value.invoices).toEqual([]);
    expect(await invoicesOf(memberId)).toHaveLength(3);
    expect(await auditCount(g.ctx.tenantId)).toBe(3);
  });

  it("continues from the latest invoice when asked for more cycles later", async () => {
    const g = await gym();
    const memberId = await member(g);
    const generate = makeGenerateInvoices(deps);
    await generate({ memberId, ahead: 0 }, g.ctx);
    const more = await generate({ memberId, ahead: 1 }, g.ctx);
    expect(more.ok && more.value.invoices.map((i) => i.periodStart)).toEqual(["2026-12-15"]);
    expect((await invoicesOf(memberId)).map((r) => r.total)).toEqual([7000, 5000]);
  });

  it("uses a one time discount on one invoice only and marks it used", async () => {
    const g = await gym();
    const memberId = await member(g);
    const once = await addDiscount(g, memberId, 1500, false);
    await makeGenerateInvoices(deps)({ memberId, ahead: 2 }, g.ctx);
    const rows = await invoicesOf(memberId);
    expect(rows.map((r) => r.total)).toEqual([5500, 5000, 5000]);
    const { rows: used } = await db.admin.query(
      "SELECT consumed_invoice_id FROM member_discounts WHERE id = $1",
      [once],
    );
    expect((used[0] as { consumed_invoice_id: string }).consumed_invoice_id).toBe(rows[0]?.id);
  });

  it("ignores an ended discount and a discount that is switched off", async () => {
    const g = await gym();
    const memberId = await member(g);
    const off = await addDiscount(g, memberId, 1000, true);
    await db.admin.query("UPDATE member_discounts SET is_active = false WHERE id = $1", [off]);
    const ended = await addDiscount(g, memberId, 1000, true);
    await db.admin.query("UPDATE member_discounts SET ends_on = '2026-06-30' WHERE id = $1", [
      ended,
    ]);
    await makeGenerateInvoices(deps)({ memberId, ahead: 0 }, g.ctx);
    expect((await invoicesOf(memberId)).map((r) => r.total)).toEqual([7000]);
  });

  it("gives no invoice to a paused or a cancelled member", async () => {
    const g = await gym();
    const paused = await member(g, "paused");
    const cancelled = await member(g, "cancelled");
    const generate = makeGenerateInvoices(deps);
    for (const memberId of [paused, cancelled]) {
      const result = await generate({ memberId, ahead: 12 }, g.ctx);
      expect(result.ok && result.value.invoices).toEqual([]);
      expect(await invoicesOf(memberId)).toEqual([]);
    }
  });

  it("never bills the cycles a member spent away, once they are back", async () => {
    const g = await gym();
    const memberId = await member(g, "active", "2026-08-15");
    await db.admin.query(
      "UPDATE membership_periods SET valid_to = '2026-09-20' WHERE member_id = $1",
      [memberId],
    );
    await db.admin.query(
      `INSERT INTO membership_periods (tenant_id, member_id, plan_id, status, valid_from, valid_to)
       VALUES ($1, $2, $3, 'cancelled', '2026-09-20', '2026-11-01')`,
      [g.ctx.tenantId, memberId, g.planId],
    );
    await db.admin.query(
      `INSERT INTO membership_periods (tenant_id, member_id, plan_id, status, valid_from)
       VALUES ($1, $2, $3, 'active', '2026-11-01')`,
      [g.ctx.tenantId, memberId, g.planId],
    );
    const august = await one(
      `INSERT INTO invoices (tenant_id, member_id, period_start, period_end, due_date, total)
       VALUES ($1, $2, '2026-08-15', '2026-09-14', '2026-08-15', 7000) RETURNING id`,
      [g.ctx.tenantId, memberId],
    );
    const result = await makeGenerateInvoices(deps)({ memberId, ahead: 0 }, g.ctx);
    expect(result.ok && result.value.invoices.map((i) => i.periodStart)).toEqual(["2026-11-15"]);
    expect((await invoicesOf(memberId)).map((r) => r.id)).toContain(august);
    expect((await invoicesOf(memberId)).map((r) => r.period_start)).toEqual([
      "2026-08-15",
      "2026-11-15",
    ]);
  });

  it("does not build a voided cycle again", async () => {
    const g = await gym();
    const memberId = await member(g);
    const generate = makeGenerateInvoices(deps);
    await generate({ memberId, ahead: 0 }, g.ctx);
    await db.admin.query(
      `UPDATE invoices SET is_void = true, void_reason = 'mistake', voided_at = now()
        WHERE member_id = $1`,
      [memberId],
    );
    const again = await generate({ memberId, ahead: 0 }, g.ctx);
    expect(again.ok && again.value.invoices).toEqual([]);
    expect(await invoicesOf(memberId)).toHaveLength(1);
  });

  it("serialises two runs for one member, so no cycle is built twice", async () => {
    const g = await gym();
    const memberId = await member(g);
    const generate = makeGenerateInvoices(deps);
    const [a, b] = await Promise.all([
      generate({ memberId, ahead: 3 }, g.ctx),
      generate({ memberId, ahead: 3 }, g.ctx),
    ]);
    const built = [a, b].map((r) => (r.ok ? r.value.invoices.length : -1));
    expect(built.sort()).toEqual([0, 4]);
    expect(await invoicesOf(memberId)).toHaveLength(4);
  });

  it("commits the invoices and their audit events together or not at all", async () => {
    const g = await gym();
    const memberId = await member(g);
    const failing = makeGenerateInvoices(
      depsWithIds(() => {
        throw new Error("audit id source is down");
      }),
    );
    await expect(failing({ memberId, ahead: 1 }, g.ctx)).rejects.toThrow("audit id source");
    expect(await invoicesOf(memberId)).toEqual([]);
    expect(await auditCount(g.ctx.tenantId)).toBe(0);
  });

  it("answers not found for a member of another gym and writes nothing", async () => {
    const gymA = await gym();
    const gymB = await gym();
    const memberB = await member(gymB);
    const generate = makeGenerateInvoices(deps);

    const attempt = await generate({ memberId: memberB, ahead: 3 }, gymA.ctx);
    expect(attempt).toEqual({
      ok: false,
      error: { kind: "not_found", message: "Member not found" },
    });
    expect(await invoicesOf(memberB)).toEqual([]);

    // Gym B's own rows stay out of sight of gym A's transaction.
    await generate({ memberId: memberB, ahead: 0 }, gymB.ctx);
    await addDiscount(gymB, memberB, 1000, true);
    await deps.withUnit(gymA.ctx.tenantId, async (unit) => {
      expect(await unit.invoices.lastPeriodEnd(memberB)).toBeNull();
      expect(await unit.invoices.discountsOf(memberB)).toEqual([]);
      expect(await unit.invoices.lockMember(memberB)).toBeNull();
      expect(await unit.invoices.findPlanFees(gymB.planId)).toBeNull();
    });
    await deps.withUnit(gymB.ctx.tenantId, async (unit) => {
      expect(await unit.invoices.lastPeriodEnd(memberB)).toBe("2026-12-14");
      expect(await unit.invoices.findPlanFees(gymB.planId)).toEqual({
        admissionFee: 2000,
        monthlyFee: 5000,
      });
    });
  });
});
