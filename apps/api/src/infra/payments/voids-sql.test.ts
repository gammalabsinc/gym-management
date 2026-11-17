import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCreateMember } from "../../app/create-member";
import { makeGetMember } from "../../app/member-queries";
import type {
  MemberQueryUnit,
  MemberUnit,
  PaymentUnit,
  VoidUnit,
  WithTenantTx,
} from "../../app/ports";
import { makeRecordPayment } from "../../app/record-payment";
import {
  ALREADY_VOID_MESSAGE,
  HAS_ALLOCATIONS_MESSAGE,
  INVOICE_VOIDED,
  makeVoidInvoice,
  makeVoidPayment,
  PAYMENT_VOIDED,
  type VoidContext,
} from "../../app/voids";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { makeWithTenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { randomCodes } from "../members/member-codes";
import { makeWithMemberQueryUnit } from "../members/member-queries-unit";
import { makeWithMemberUnit } from "../members/members-unit";
import { makeWithPaymentUnit } from "./payments-unit";
import { makeWithVoidUnit } from "./voids-unit";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
/** Morning of 16 November in Toronto. */
const NOW = new Date("2026-11-16T15:00:00.000Z");
const CLOCK = { now: () => NOW };

let db: TestDatabase;
let source: DataSource;
let withMember: WithTenantTx<MemberUnit>;
let withPayment: WithTenantTx<PaymentUnit>;
let withVoid: WithTenantTx<VoidUnit>;
let withQueries: WithTenantTx<MemberQueryUnit>;
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
  withVoid = makeWithVoidUnit(withTenantTx, audit);
  withQueries = makeWithMemberQueryUnit(withTenantTx);
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
  readonly owner: VoidContext;
  readonly staff: VoidContext;
}

/** A gym with an owner and a staff user and the default plan: 2000 to join and 5000 a month. */
async function gym(): Promise<Gym> {
  counter += 1;
  const tenantId = await one(
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $1, 'America/Toronto', 'CAD') RETURNING id",
    [`void-gym-${counter}`],
  );
  const ownerId = await one("INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id", [
    tenantId,
    `owner-${counter}@example.test`,
  ]);
  const staffId = await one("INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id", [
    tenantId,
    `staff-${counter}@example.test`,
  ]);
  await db.admin.query(
    "INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee) VALUES ($1, 'default', 'Default', 2000, 5000)",
    [tenantId],
  );
  return {
    owner: { roles: ["owner"], tenantId, userId: ownerId, requestId: `req-owner-${counter}` },
    staff: { roles: ["staff"], tenantId, userId: staffId, requestId: `req-staff-${counter}` },
  };
}

async function member(g: Gym, joinDate: string): Promise<string> {
  counter += 1;
  const created = await makeCreateMember({
    withUnit: withMember,
    clock: CLOCK,
    codes: randomCodes,
  })({ fullName: "Ada Lovelace", email: `ada-${counter}@example.test`, joinDate }, g.staff);
  if (!created.ok) throw new Error(`expected a member, got ${created.error.message}`);
  return created.value.memberId;
}

const record = makeRecordPayment({ withUnit: (t, fn) => withPayment(t, fn), clock: CLOCK });
const voidPayment = makeVoidPayment({ withUnit: (t, fn) => withVoid(t, fn), clock: CLOCK });
const voidInvoice = makeVoidInvoice({ withUnit: (t, fn) => withVoid(t, fn), clock: CLOCK });
const getMember = makeGetMember({ withUnit: (t, fn) => withQueries(t, fn), clock: CLOCK });

async function pay(g: Gym, memberId: string, amount: number): Promise<string> {
  const result = await record(
    { clientRequestId: randomUUID(), memberId, amount, method: "cash" },
    g.staff,
  );
  if (!result.ok) throw new Error(`expected a payment, got ${result.error.message}`);
  return result.value.id;
}

async function standing(g: Gym, memberId: string) {
  const result = await getMember({ memberId }, g.staff);
  if (!result.ok) throw new Error("expected the member");
  return { standing: result.value.standing, balanceDue: result.value.balanceDue };
}

async function count(table: string, tenantId: string): Promise<number> {
  const { rows } = await db.admin.query(
    `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
    [tenantId],
  );
  return (rows[0] as { n: number }).n;
}

async function ledgerOf(g: Gym, memberId: string) {
  const ledger = await withPayment(g.owner.tenantId, (unit) => unit.payments.ledger(memberId));
  return ledger.map((i) => ({ start: i.periodStart, due: i.amountDue }));
}

async function invoiceIdOf(memberId: string, periodStart: string): Promise<string> {
  return one("SELECT id FROM invoices WHERE member_id = $1 AND period_start = $2 AND NOT is_void", [
    memberId,
    periodStart,
  ]);
}

describe("voiding a payment against Postgres", () => {
  it("keeps the rows, stops the allocations counting, and reopens the invoice", async () => {
    const g = await gym();
    const memberId = await member(g, "2026-11-10");
    const paymentId = await pay(g, memberId, 7000);
    expect(await standing(g, memberId)).toEqual({ standing: "paid", balanceDue: 0 });
    const allocationsBefore = await count("payment_allocations", g.owner.tenantId);

    const result = await voidPayment({ paymentId, reason: " typed the wrong member " }, g.owner);
    expect(result).toMatchObject({
      ok: true,
      value: {
        id: paymentId,
        memberId,
        amount: 7000,
        reason: "typed the wrong member",
        reallocated: [],
      },
    });
    expect(result.ok && result.value.reversed).toHaveLength(1);

    expect(await count("payment_allocations", g.owner.tenantId)).toBe(allocationsBefore);
    const { rows } = await db.admin.query(
      "SELECT is_void, void_reason, voided_by, voided_at FROM payments WHERE id = $1",
      [paymentId],
    );
    expect(rows).toEqual([
      {
        is_void: true,
        void_reason: "typed the wrong member",
        voided_by: g.owner.userId,
        voided_at: NOW,
      },
    ]);
    expect(await ledgerOf(g, memberId)).toEqual([{ start: "2026-11-10", due: 7000 }]);
    expect(await standing(g, memberId)).toEqual({ standing: "overdue", balanceDue: 7000 });
  });

  it("recomputes standing for a member who was behind and caught up", async () => {
    const g = await gym();
    const memberId = await member(g, "2026-10-10");
    expect((await standing(g, memberId)).standing).toBe("overdue");
    const paymentId = await pay(g, memberId, 12000);
    expect(await standing(g, memberId)).toEqual({ standing: "paid", balanceDue: 0 });
    await voidPayment({ paymentId, reason: "bounced" }, g.owner);
    expect(await standing(g, memberId)).toEqual({ standing: "overdue", balanceDue: 12000 });
  });

  it("puts the credit that other payments hold towards the invoices it reopens", async () => {
    const g = await gym();
    const memberId = await member(g, "2026-11-10");
    const first = await pay(g, memberId, 7000);
    const second = await pay(g, memberId, 3000);
    expect(await ledgerOf(g, memberId)).toEqual([{ start: "2026-11-10", due: 0 }]);

    const result = await voidPayment({ paymentId: first, reason: "wrong amount" }, g.owner);
    expect(result.ok && result.value.reallocated).toEqual([
      { paymentId: second, invoiceId: await invoiceIdOf(memberId, "2026-11-10"), amount: 3000 },
    ]);
    expect(await ledgerOf(g, memberId)).toEqual([{ start: "2026-11-10", due: 4000 }]);
    expect((await standing(g, memberId)).balanceDue).toBe(4000);
  });

  it("cannot be voided twice, even by two requests at once", async () => {
    const g = await gym();
    const memberId = await member(g, "2026-11-10");
    const paymentId = await pay(g, memberId, 7000);
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        voidPayment({ paymentId, reason: "dup" }, { ...g.owner, requestId: `race-${i}` }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const result of results.filter((r) => !r.ok)) {
      expect(result).toMatchObject({ error: { kind: "conflict", message: ALREADY_VOID_MESSAGE } });
    }
    const { rows } = await db.admin.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = $2",
      [g.owner.tenantId, PAYMENT_VOIDED],
    );
    expect(rows).toEqual([{ n: 1 }]);
  });

  it("writes one audit event with the reason", async () => {
    const g = await gym();
    const memberId = await member(g, "2026-11-10");
    const paymentId = await pay(g, memberId, 7000);
    await voidPayment({ paymentId, reason: "bounced" }, g.owner);
    const { rows } = await db.admin.query(
      "SELECT actor_user_id, entity_type, entity_id, before, after FROM audit_events WHERE tenant_id = $1 AND action = $2",
      [g.owner.tenantId, PAYMENT_VOIDED],
    );
    expect(rows).toEqual([
      {
        actor_user_id: g.owner.userId,
        entity_type: "payment",
        entity_id: paymentId,
        before: { isVoid: false },
        after: expect.objectContaining({ isVoid: true, reason: "bounced", memberId, amount: 7000 }),
      },
    ]);
  });

  it("is for owners only", async () => {
    const g = await gym();
    const memberId = await member(g, "2026-11-10");
    const paymentId = await pay(g, memberId, 7000);
    for (const roles of [["staff"], ["member"], []] as const) {
      const result = await voidPayment({ paymentId, reason: "no" }, { ...g.owner, roles });
      expect(!result.ok && result.error.kind).toBe("forbidden");
    }
    expect(await standing(g, memberId)).toEqual({ standing: "paid", balanceDue: 0 });
  });

  it("says not found for a payment that does not exist, and refuses a bad id", async () => {
    const g = await gym();
    const missing = await voidPayment({ paymentId: randomUUID(), reason: "x" }, g.owner);
    expect(!missing.ok && missing.error.kind).toBe("not_found");
    const bad = await voidPayment({ paymentId: "nope", reason: "" }, g.owner);
    expect(!bad.ok && bad.error.kind).toBe("validation");
  });
});

describe("voiding an invoice against Postgres", () => {
  it("is refused while a payment is applied, then works once the payment is void", async () => {
    const g = await gym();
    const memberId = await member(g, "2026-11-10");
    const invoiceId = await invoiceIdOf(memberId, "2026-11-10");
    const paymentId = await pay(g, memberId, 7000);

    const refused = await voidInvoice({ invoiceId, reason: "billed in error" }, g.owner);
    expect(refused).toMatchObject({
      ok: false,
      error: { kind: "conflict", message: HAS_ALLOCATIONS_MESSAGE },
    });

    await voidPayment({ paymentId, reason: "refunded" }, g.owner);
    const voided = await voidInvoice({ invoiceId, reason: "billed in error" }, g.owner);
    expect(voided).toEqual({
      ok: true,
      value: { id: invoiceId, memberId, reason: "billed in error" },
    });
  });

  it("keeps the invoice and its lines, and standing follows", async () => {
    const g = await gym();
    const memberId = await member(g, "2026-11-10");
    const invoiceId = await invoiceIdOf(memberId, "2026-11-10");
    const lines = await count("invoice_lines", g.owner.tenantId);
    expect((await standing(g, memberId)).balanceDue).toBe(7000);

    await voidInvoice({ invoiceId, reason: "duplicate" }, g.owner);

    expect(await count("invoice_lines", g.owner.tenantId)).toBe(lines);
    const { rows } = await db.admin.query(
      "SELECT is_void, void_reason, voided_by FROM invoices WHERE id = $1",
      [invoiceId],
    );
    expect(rows).toEqual([{ is_void: true, void_reason: "duplicate", voided_by: g.owner.userId }]);
    expect(await standing(g, memberId)).toEqual({ standing: "paid", balanceDue: 0 });
  });

  it("cannot be voided twice", async () => {
    const g = await gym();
    const memberId = await member(g, "2026-11-10");
    const invoiceId = await invoiceIdOf(memberId, "2026-11-10");
    await voidInvoice({ invoiceId, reason: "duplicate" }, g.owner);
    const again = await voidInvoice({ invoiceId, reason: "duplicate" }, g.owner);
    expect(again).toMatchObject({
      ok: false,
      error: { kind: "conflict", message: ALREADY_VOID_MESSAGE },
    });
    const { rows } = await db.admin.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = $2",
      [g.owner.tenantId, INVOICE_VOIDED],
    );
    expect(rows).toEqual([{ n: 1 }]);
  });

  it("is for owners only, and says not found for an unknown invoice", async () => {
    const g = await gym();
    const memberId = await member(g, "2026-11-10");
    const invoiceId = await invoiceIdOf(memberId, "2026-11-10");
    const denied = await voidInvoice({ invoiceId, reason: "no" }, { ...g.owner, roles: ["staff"] });
    expect(!denied.ok && denied.error.kind).toBe("forbidden");
    const missing = await voidInvoice({ invoiceId: randomUUID(), reason: "x" }, g.owner);
    expect(!missing.ok && missing.error.kind).toBe("not_found");
    const bad = await voidInvoice({ invoiceId: "nope", reason: "x" }, g.owner);
    expect(!bad.ok && bad.error.kind).toBe("validation");
  });
});

describe("across gyms", () => {
  it("cannot void another gym's payment or invoice", async () => {
    const a = await gym();
    const b = await gym();
    const memberA = await member(a, "2026-11-10");
    const paymentA = await pay(a, memberA, 7000);
    const invoiceA = await invoiceIdOf(memberA, "2026-11-10");
    const memberB = await member(b, "2026-11-10");
    const invoiceB = await invoiceIdOf(memberB, "2026-11-10");

    const payment = await voidPayment({ paymentId: paymentA, reason: "x" }, b.owner);
    const invoice = await voidInvoice({ invoiceId: invoiceA, reason: "x" }, b.owner);
    const own = await voidInvoice({ invoiceId: invoiceB, reason: "x" }, a.owner);
    expect(!payment.ok && payment.error.kind).toBe("not_found");
    expect(!invoice.ok && invoice.error.kind).toBe("not_found");
    expect(!own.ok && own.error.kind).toBe("not_found");

    const seen = await withVoid(b.owner.tenantId, async (unit) => ({
      payment: await unit.voids.findPayment(paymentA),
      invoice: await unit.voids.findInvoice(invoiceA),
      credits: await unit.voids.spareCredits(memberA),
    }));
    expect(seen).toEqual({ payment: null, invoice: null, credits: [] });
    expect(await standing(a, memberA)).toEqual({ standing: "paid", balanceDue: 0 });
  });
});
