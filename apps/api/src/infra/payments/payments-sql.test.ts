import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makePauseMember } from "../../app/change-membership";
import { makeCreateMember } from "../../app/create-member";
import type { MembershipUnit, MemberUnit, PaymentUnit, WithTenantTx } from "../../app/ports";
import {
  makeRecordPayment,
  PAYMENT_RECORDED,
  REQUEST_ID_REUSED_MESSAGE,
  type RecordPaymentContext,
} from "../../app/record-payment";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { makeWithTenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { randomCodes } from "../members/member-codes";
import { makeWithMemberUnit } from "../members/members-unit";
import { makeWithMembershipUnit } from "../memberships/memberships-unit";
import { makeWithPaymentUnit } from "./payments-unit";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
/** Morning of 16 November in Toronto. */
const NOW = new Date("2026-11-16T15:00:00.000Z");
const CLOCK = { now: () => NOW };

let db: TestDatabase;
let source: DataSource;
let withMember: WithTenantTx<MemberUnit>;
let withPayment: WithTenantTx<PaymentUnit>;
let withMembership: WithTenantTx<MembershipUnit>;
let counter = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  source = new DataSource({
    ...dataSourceOptions(db.urlFor(APP_ROLE, PASSWORDS.appPassword)),
    extra: { max: 8 },
  });
  await source.initialize();
  const withTenantTx = makeWithTenantTx(source);
  const audit = { clock: CLOCK, ids: { next: randomUUID } };
  withMember = makeWithMemberUnit(withTenantTx, audit);
  withPayment = makeWithPaymentUnit(withTenantTx, audit);
  withMembership = makeWithMembershipUnit(withTenantTx, audit);
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
  readonly ctx: RecordPaymentContext;
}

/** A gym with one staff user and the default plan: 2000 to join and 5000 a month. */
async function gym(): Promise<Gym> {
  counter += 1;
  const tenantId = await one(
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $1, 'America/Toronto', 'CAD') RETURNING id",
    [`pay-gym-${counter}`],
  );
  const userId = await one("INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id", [
    tenantId,
    `staff-${counter}@example.test`,
  ]);
  await db.admin.query(
    "INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee) VALUES ($1, 'default', 'Default', 2000, 5000)",
    [tenantId],
  );
  return { ctx: { roles: ["staff"], tenantId, userId, requestId: `req-${counter}` } };
}

/** A member of the gym who joined on the given day, with every invoice up to today. */
async function member(g: Gym, joinDate = "2026-11-10"): Promise<string> {
  counter += 1;
  const created = await makeCreateMember({
    withUnit: withMember,
    clock: CLOCK,
    codes: randomCodes,
  })({ fullName: "Ada Lovelace", email: `ada-${counter}@example.test`, joinDate }, g.ctx);
  if (!created.ok) throw new Error(`expected a member, got ${created.error.message}`);
  return created.value.memberId;
}

const record = makeRecordPayment({ withUnit: (t, fn) => withPayment(t, fn), clock: CLOCK });

const payment = (memberId: string, amount: number, extra: Record<string, unknown> = {}) => ({
  clientRequestId: randomUUID(),
  memberId,
  amount,
  method: "cash",
  ...extra,
});

async function recorded(g: Gym, memberId: string, amount: number, extra = {}) {
  const result = await record(payment(memberId, amount, extra), g.ctx);
  if (!result.ok) throw new Error(`expected a payment, got ${result.error.message}`);
  return result.value;
}

async function rows<Row>(sql: string, params: unknown[]): Promise<Row[]> {
  return (await db.admin.query(sql, params)).rows as Row[];
}

async function count(table: string, tenantId: string): Promise<number> {
  const [row] = await rows<{ n: string }>(
    `SELECT count(*) AS n FROM ${table} WHERE tenant_id = $1`,
    [tenantId],
  );
  return Number(row?.n);
}

interface InvoiceRow {
  readonly id: string;
  readonly start: string;
  readonly total: number;
  readonly paid: number;
}

/** The member's live invoices, oldest first, with what has been allocated to each. */
function invoicesOf(memberId: string): Promise<InvoiceRow[]> {
  return rows<InvoiceRow>(
    `SELECT i.id, i.period_start::text AS start, i.total,
            COALESCE(SUM(a.amount) FILTER (WHERE NOT p.is_void), 0)::int AS paid
       FROM invoices i
       LEFT JOIN payment_allocations a ON a.invoice_id = i.id
       LEFT JOIN payments p ON p.id = a.payment_id
      WHERE i.member_id = $1 AND NOT i.is_void
      GROUP BY i.id ORDER BY i.period_start`,
    [memberId],
  );
}

describe("recording a payment on a real database", () => {
  it("settles the first invoice and writes the payment, the allocation and the audit event", async () => {
    const g = await gym();
    const memberId = await member(g);
    const [first] = await invoicesOf(memberId);
    const result = await recorded(g, memberId, 7000, {
      method: "card",
      paidOn: "2026-11-12",
      proofLink: "https://example.test/receipt/1",
    });

    expect(result).toMatchObject({
      memberId,
      amount: 7000,
      method: "card",
      paidOn: "2026-11-12",
      proofLink: "https://example.test/receipt/1",
      recordedBy: g.ctx.userId,
      isVoid: false,
      voidReason: null,
      credit: 0,
      replayed: false,
      allocations: [{ invoiceId: first?.id, amount: 7000 }],
    });
    expect(await invoicesOf(memberId)).toEqual([
      { id: first?.id, start: "2026-11-10", total: 7000, paid: 7000 },
    ]);
    const events = await rows<{ action: string; entity_id: string; actor: string }>(
      "SELECT action, entity_id, actor_user_id AS actor FROM audit_events WHERE tenant_id = $1 AND action = $2",
      [g.ctx.tenantId, PAYMENT_RECORDED],
    );
    expect(events).toEqual([
      { action: PAYMENT_RECORDED, entity_id: result.id, actor: g.ctx.userId },
    ]);
  });

  it("dates a payment today in the gym's calendar when no date is given", async () => {
    const g = await gym();
    const memberId = await member(g);
    const result = await recorded(g, memberId, 1000);
    expect(result.paidOn).toBe("2026-11-16");
    expect(result.proofLink).toBeNull();
    expect(result.submittedAt).toMatch(/^2\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  });

  it("pays an invoice in part and finishes it with the next payment", async () => {
    const g = await gym();
    const memberId = await member(g);
    await recorded(g, memberId, 3000);
    expect((await invoicesOf(memberId)).map((i) => i.paid)).toEqual([3000]);
    const second = await recorded(g, memberId, 4000);
    expect(second.allocations).toEqual([expect.objectContaining({ amount: 4000 })]);
    expect((await invoicesOf(memberId)).map((i) => [i.total, i.paid])).toEqual([[7000, 7000]]);
  });

  it("settles the oldest unpaid invoice first and builds the ones that are due by today", async () => {
    const g = await gym();
    const memberId = await member(g, "2026-09-10");
    const before = await invoicesOf(memberId);
    expect(before.map((i) => [i.start, i.total])).toEqual([
      ["2026-09-10", 7000],
      ["2026-10-10", 5000],
      ["2026-11-10", 5000],
    ]);
    const result = await recorded(g, memberId, 9000);
    expect(result.allocations).toEqual([
      { invoiceId: before[0]?.id, amount: 7000 },
      { invoiceId: before[1]?.id, amount: 2000 },
    ]);
    expect((await invoicesOf(memberId)).map((i) => i.paid)).toEqual([7000, 2000, 0]);
  });

  it("builds the next cycles ahead when the payment covers future months", async () => {
    const g = await gym();
    const memberId = await member(g);
    const result = await recorded(g, memberId, 17000);

    expect(result.credit).toBe(0);
    const invoices = await invoicesOf(memberId);
    expect(invoices.map((i) => [i.start, i.total, i.paid])).toEqual([
      ["2026-11-10", 7000, 7000],
      ["2026-12-10", 5000, 5000],
      ["2027-01-10", 5000, 5000],
    ]);
    expect(result.allocations.map((a) => a.invoiceId)).toEqual(invoices.map((i) => i.id));
    expect(await count("invoices", g.ctx.tenantId)).toBe(3);
  });

  it("keeps a remainder smaller than the next invoice as credit and builds nothing for it", async () => {
    const g = await gym();
    const memberId = await member(g);
    const result = await recorded(g, memberId, 9000);
    expect(result.credit).toBe(2000);
    expect(result.allocations).toHaveLength(1);
    expect(await invoicesOf(memberId)).toHaveLength(1);
  });

  it("keeps the whole payment as credit when nothing is owed and no cycle is covered", async () => {
    const g = await gym();
    const memberId = await member(g);
    await recorded(g, memberId, 7000);
    const result = await recorded(g, memberId, 1500);
    expect(result).toMatchObject({ allocations: [], credit: 1500 });
    expect(await count("payment_allocations", g.ctx.tenantId)).toBe(1);
    expect(await count("payments", g.ctx.tenantId)).toBe(2);
  });

  it("builds at most 12 cycles ahead and keeps the rest as credit", async () => {
    const g = await gym();
    const memberId = await member(g);
    const result = await recorded(g, memberId, 100000);
    const invoices = await invoicesOf(memberId);
    expect(invoices).toHaveLength(13);
    expect(invoices.at(-1)?.start).toBe("2027-11-10");
    expect(result.credit).toBe(100000 - (7000 + 12 * 5000));
    expect(invoices.every((i) => i.paid === i.total)).toBe(true);
  });

  it("returns the first result and writes once when the same request is sent twice", async () => {
    const g = await gym();
    const memberId = await member(g);
    const request = payment(memberId, 7000);
    const first = await record(request, g.ctx);
    const second = await record({ ...request, amount: 9999, method: "card" }, g.ctx);
    if (!first.ok || !second.ok) throw new Error("expected both calls to succeed");

    expect(first.value.replayed).toBe(false);
    expect(second.value).toEqual({ ...first.value, replayed: true });
    expect(await count("payments", g.ctx.tenantId)).toBe(1);
    expect(await count("payment_allocations", g.ctx.tenantId)).toBe(1);
    expect(
      (
        await rows("SELECT 1 FROM audit_events WHERE tenant_id = $1 AND action = $2", [
          g.ctx.tenantId,
          PAYMENT_RECORDED,
        ])
      ).length,
    ).toBe(1);
  });

  it("writes once when the same request arrives twice at the same moment", async () => {
    const g = await gym();
    const memberId = await member(g);
    const request = payment(memberId, 7000);
    const [a, b] = await Promise.all([record(request, g.ctx), record(request, g.ctx)]);
    if (!a.ok || !b.ok) throw new Error("expected both calls to succeed");
    expect(a.value.id).toBe(b.value.id);
    expect([a.value.replayed, b.value.replayed].sort()).toEqual([false, true]);
    expect(await count("payments", g.ctx.tenantId)).toBe(1);
  });

  it("refuses a request id that was used for another member, and writes nothing", async () => {
    const g = await gym();
    const memberA = await member(g);
    const memberB = await member(g);
    const request = payment(memberA, 7000);
    await record(request, g.ctx);
    const reused = await record({ ...request, memberId: memberB }, g.ctx);
    expect(reused).toEqual({
      ok: false,
      error: { kind: "conflict", message: REQUEST_ID_REUSED_MESSAGE },
    });
    expect(await count("payments", g.ctx.tenantId)).toBe(1);
    expect((await invoicesOf(memberB)).map((i) => i.paid)).toEqual([0]);
  });

  it("refuses a request id that another member's payment takes at the same moment", async () => {
    const g = await gym();
    const memberA = await member(g);
    const memberB = await member(g);
    const requestId = randomUUID();
    const results = await Promise.all([
      record({ ...payment(memberA, 7000), clientRequestId: requestId }, g.ctx),
      record({ ...payment(memberB, 7000), clientRequestId: requestId }, g.ctx),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, error: { kind: "conflict", message: REQUEST_ID_REUSED_MESSAGE } },
    ]);
    expect(await count("payments", g.ctx.tenantId)).toBe(1);
    expect(await count("payment_allocations", g.ctx.tenantId)).toBe(1);
  });

  it("takes turns for two different payments for one member and never over allocates", async () => {
    const g = await gym();
    const memberId = await member(g);
    const results = await Promise.all([
      record(payment(memberId, 7000), g.ctx),
      record(payment(memberId, 7000), g.ctx),
    ]);
    if (!results[0]?.ok || !results[1]?.ok) throw new Error("expected both payments to succeed");

    const invoices = await invoicesOf(memberId);
    expect(invoices.map((i) => [i.start, i.total, i.paid])).toEqual([
      ["2026-11-10", 7000, 7000],
      ["2026-12-10", 5000, 5000],
    ]);
    const credit = results[0].value.credit + results[1].value.credit;
    expect(credit).toBe(2000);
    const perPayment = await rows<{ amount: number; allocated: number }>(
      `SELECT p.amount, COALESCE(SUM(a.amount), 0)::int AS allocated
         FROM payments p LEFT JOIN payment_allocations a ON a.payment_id = p.id
        WHERE p.member_id = $1 GROUP BY p.id`,
      [memberId],
    );
    expect(perPayment.every((p) => p.allocated <= p.amount)).toBe(true);
  });

  it("does not count the allocations of a void payment, so the invoice is owed again", async () => {
    const g = await gym();
    const memberId = await member(g);
    const first = await recorded(g, memberId, 7000);
    await db.admin.query(
      `UPDATE payments SET is_void = true, void_reason = 'bounced', voided_by = $2, voided_at = now()
        WHERE id = $1`,
      [first.id, g.ctx.userId],
    );
    expect((await invoicesOf(memberId)).map((i) => i.paid)).toEqual([0]);
    const again = await recorded(g, memberId, 7000);
    expect(again.allocations).toEqual([expect.objectContaining({ amount: 7000 })]);
    expect((await invoicesOf(memberId)).map((i) => i.paid)).toEqual([7000]);
  });

  it("settles what a paused member owes but builds no invoice ahead", async () => {
    const g = await gym();
    const memberId = await member(g);
    const paused = await makePauseMember({ withUnit: withMembership, clock: CLOCK })(
      { memberId, reason: "away" },
      { ...g.ctx, roles: ["owner"] },
    );
    expect(paused.ok).toBe(true);
    const result = await recorded(g, memberId, 9000);
    expect(result.credit).toBe(2000);
    expect((await invoicesOf(memberId)).map((i) => i.paid)).toEqual([7000]);
  });

  it("refuses an invalid payment and writes nothing", async () => {
    const g = await gym();
    const memberId = await member(g);
    for (const bad of [
      { amount: 0 },
      { amount: 12.5 },
      { method: "barter" },
      { paidOn: "2026-11-17" },
      { proofLink: "ftp://example.test/x" },
      { clientRequestId: "not-a-uuid" },
    ]) {
      const result = await record({ ...payment(memberId, 1000), ...bad }, g.ctx);
      expect(result.ok, JSON.stringify(bad)).toBe(false);
    }
    expect(await count("payments", g.ctx.tenantId)).toBe(0);
  });

  it("answers not found for a member the gym does not have", async () => {
    const g = await gym();
    const result = await record(payment(randomUUID(), 1000), g.ctx);
    expect(result).toEqual({
      ok: false,
      error: { kind: "not_found", message: "Member not found" },
    });
    expect(await count("payments", g.ctx.tenantId)).toBe(0);
  });

  it("refuses a caller without the permission before anything is read", async () => {
    const g = await gym();
    const memberId = await member(g);
    for (const roles of [[], ["member"]] as const) {
      const result = await record(payment(memberId, 1000), { ...g.ctx, roles });
      expect(!result.ok && result.error.kind).toBe("forbidden");
    }
    expect(await count("payments", g.ctx.tenantId)).toBe(0);
  });

  it("rolls everything back when the audit event cannot be written", async () => {
    const g = await gym();
    const memberId = await member(g);
    const failing = makeRecordPayment({
      clock: CLOCK,
      withUnit: (tenantId, fn) =>
        withPayment(tenantId, (unit) =>
          fn({
            ...unit,
            audit: {
              record: async () => {
                throw new Error("audit is down");
              },
            },
          }),
        ),
    });
    await expect(failing(payment(memberId, 17000), g.ctx)).rejects.toThrow("audit is down");
    expect(await count("payments", g.ctx.tenantId)).toBe(0);
    expect(await count("payment_allocations", g.ctx.tenantId)).toBe(0);
    expect((await invoicesOf(memberId)).map((i) => i.start)).toEqual(["2026-11-10"]);
  });

  describe("across gyms", () => {
    it("cannot reach another gym's member, payments or request ids", async () => {
      const a = await gym();
      const b = await gym();
      const memberA = await member(a);
      const memberB = await member(b);
      const requestId = randomUUID();
      const inA = await record({ ...payment(memberA, 7000), clientRequestId: requestId }, a.ctx);

      const crossed = await record(payment(memberA, 7000), b.ctx);
      expect(!crossed.ok && crossed.error.kind).toBe("not_found");

      const sameKey = await record(
        { ...payment(memberB, 7000), clientRequestId: requestId },
        b.ctx,
      );
      if (!inA.ok || !sameKey.ok) throw new Error("expected both gyms to record");
      expect(sameKey.value.id).not.toBe(inA.value.id);
      expect(sameKey.value.replayed).toBe(false);
      expect(await count("payments", a.ctx.tenantId)).toBe(1);
      expect(await count("payments", b.ctx.tenantId)).toBe(1);
      expect((await invoicesOf(memberA)).map((i) => i.paid)).toEqual([7000]);
    });

    it("sees no unpaid invoices and no stored payments without a tenant", async () => {
      const g = await gym();
      const memberId = await member(g);
      const request = payment(memberId, 7000);
      await record(request, g.ctx);
      const other = await gym();
      const seen = await withPayment(other.ctx.tenantId, async (unit) => ({
        found: await unit.payments.findByRequestId(request.clientRequestId),
        unpaid: await unit.payments.unpaidInvoices(memberId),
      }));
      expect(seen).toEqual({ found: null, unpaid: [] });
    });
  });
});
