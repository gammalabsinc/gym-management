import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type LedgerCaller,
  type MemberLedgerDeps,
  makeMemberDiscounts,
  makeMemberInvoices,
  makeMemberPayments,
  makeMembershipHistory,
} from "../../app/member-ledger";
import type { LedgerUnit, WithTenantTx } from "../../app/ports";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { makeWithTenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { makeWithLedgerUnit } from "./ledger-unit";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
/** Noon on 17 November in Toronto. */
const NOW = new Date("2026-11-17T17:00:00.000Z");
const CLOCK = { now: () => NOW };

let db: TestDatabase;
let source: DataSource;
let withLedger: WithTenantTx<LedgerUnit>;
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
  withLedger = makeWithLedgerUnit(makeWithTenantTx(source));
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
  readonly staffUserId: string;
  readonly planId: string;
  readonly staff: LedgerCaller;
  readonly owner: LedgerCaller;
}

async function gym(): Promise<Gym> {
  counter += 1;
  const tenantId = await one(
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $1, 'America/Toronto', 'CAD') RETURNING id",
    [`ledger-gym-${counter}`],
  );
  const staffUserId = await one(
    "INSERT INTO users (tenant_id, email, name) VALUES ($1, $2, 'Sam Staff') RETURNING id",
    [tenantId, `staff-${counter}@example.test`],
  );
  const planId = await one(
    "INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee) VALUES ($1, 'default', 'Default', 2000, 5000) RETURNING id",
    [tenantId],
  );
  return {
    tenantId,
    staffUserId,
    planId,
    staff: { roles: ["staff"], tenantId, userId: staffUserId },
    owner: { roles: ["owner"], tenantId, userId: staffUserId },
  };
}

interface Member {
  readonly id: string;
  readonly userId: string;
  readonly self: LedgerCaller;
}

/** A member with one open period from 1 September. The ledger rows are added by each test. */
async function member(g: Gym, name = "Ada Lovelace"): Promise<Member> {
  counter += 1;
  const userId = await one(
    "INSERT INTO users (tenant_id, email, name) VALUES ($1, $2, $3) RETURNING id",
    [g.tenantId, `member-${counter}@example.test`, name],
  );
  const id = await one(
    `INSERT INTO members (tenant_id, user_id, member_no, barcode, billing_day)
     VALUES ($1, $2, $3, $4, 1) RETURNING id`,
    [g.tenantId, userId, `L${String(counter).padStart(5, "0")}`, `bc-${randomUUID()}`],
  );
  await db.admin.query(
    `INSERT INTO membership_periods (tenant_id, member_id, plan_id, status, valid_from)
     VALUES ($1, $2, $3, 'active', '2026-09-01')`,
    [g.tenantId, id, g.planId],
  );
  return { id, userId, self: { roles: ["member"], tenantId: g.tenantId, userId } };
}

async function invoice(
  g: Gym,
  memberId: string,
  periodStart: string,
  total: number,
  voided: string | null = null,
): Promise<string> {
  const end = `${periodStart.slice(0, 8)}28`;
  const id = await one(
    `INSERT INTO invoices (tenant_id, member_id, period_start, period_end, due_date, total,
                           is_void, void_reason, voided_by, voided_at)
     VALUES ($1, $2, $3, $4, $3, $5, $6, $7, $8, CASE WHEN $6 THEN now() END) RETURNING id`,
    [
      g.tenantId,
      memberId,
      periodStart,
      end,
      total,
      voided !== null,
      voided,
      voided === null ? null : g.staffUserId,
    ],
  );
  await db.admin.query(
    `INSERT INTO invoice_lines (tenant_id, invoice_id, line_type, description, amount)
     VALUES ($1, $2, 'membership', 'Monthly fee', $3)`,
    [g.tenantId, id, total],
  );
  return id;
}

async function pay(
  g: Gym,
  memberId: string,
  amount: number,
  paidOn: string,
  invoices: readonly { id: string; amount: number }[] = [],
  voided: string | null = null,
): Promise<string> {
  const id = await one(
    `INSERT INTO payments (tenant_id, member_id, amount, method, paid_on, recorded_by,
                           client_request_id, is_void, void_reason, voided_by, voided_at)
     VALUES ($1, $2, $3, 'cash', $4, $5, gen_random_uuid(), $6, $7, $8, CASE WHEN $6 THEN now() END)
     RETURNING id`,
    [
      g.tenantId,
      memberId,
      amount,
      paidOn,
      g.staffUserId,
      voided !== null,
      voided,
      voided === null ? null : g.staffUserId,
    ],
  );
  for (const allocation of invoices) {
    await db.admin.query(
      "INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, amount) VALUES ($1, $2, $3, $4)",
      [g.tenantId, id, allocation.id, allocation.amount],
    );
  }
  return id;
}

const deps: MemberLedgerDeps = { withUnit: (t, fn) => withLedger(t, fn), clock: CLOCK };
const invoices = makeMemberInvoices(deps);
const payments = makeMemberPayments(deps);
const discounts = makeMemberDiscounts(deps);
const history = makeMembershipHistory(deps);

function value<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("invoices against Postgres", () => {
  it("derives status and amount owing, ignoring voided payments, and pages without gaps", async () => {
    const g = await gym();
    const m = await member(g);
    await invoice(g, m.id, "2026-08-01", 5000, "Entered twice");
    const october = await invoice(g, m.id, "2026-10-01", 5000);
    const november = await invoice(g, m.id, "2026-11-01", 5000);
    await invoice(g, m.id, "2026-12-01", 5000);
    await pay(g, m.id, 5000, "2026-10-02", [{ id: october, amount: 5000 }]);
    await pay(g, m.id, 2000, "2026-11-03", [{ id: november, amount: 2000 }]);
    // A voided payment keeps its allocation row, and none of it counts as paid.
    await pay(g, m.id, 3000, "2026-11-04", [{ id: november, amount: 3000 }], "Bounced");

    const first = value(await invoices({ memberId: m.id, limit: 3 }, g.staff));
    expect(first.items.map((i) => [i.periodStart, i.status, i.amountOwing])).toEqual([
      ["2026-12-01", "upcoming", 5000],
      ["2026-11-01", "unpaid", 3000],
      ["2026-10-01", "paid", 0],
    ]);
    expect(first.items[1]).toMatchObject({
      periodEnd: "2026-11-28",
      dueDate: "2026-11-01",
      total: 5000,
      amountDue: 3000,
      lines: [{ type: "membership", description: "Monthly fee", amount: 5000 }],
    });
    expect(first.nextCursor).not.toBeNull();

    const second = value(
      await invoices({ memberId: m.id, limit: 3, cursor: first.nextCursor }, g.staff),
    );
    expect(second.items).toHaveLength(1);
    expect(second.items[0]).toMatchObject({
      periodStart: "2026-08-01",
      status: "voided",
      voidReason: "Entered twice",
      amountOwing: 0,
    });
    expect(second.nextCursor).toBeNull();
  });

  it("keeps the lines of an invoice with a discount in the order they were written", async () => {
    const g = await gym();
    const m = await member(g);
    const id = await invoice(g, m.id, "2026-11-01", 5000);
    await db.admin.query(
      `INSERT INTO invoice_lines (tenant_id, invoice_id, line_type, description, amount)
       VALUES ($1, $2, 'discount', 'Referral discount', -500)`,
      [g.tenantId, id],
    );
    const page = value(await invoices({ memberId: m.id }, g.owner));
    expect(page.items[0]?.lines.map((line) => line.type)).toEqual(["membership", "discount"]);
  });

  it("shows an invoice that has no lines with an empty list", async () => {
    const g = await gym();
    const m = await member(g);
    await db.admin.query(
      `INSERT INTO invoices (tenant_id, member_id, period_start, period_end, due_date, total)
       VALUES ($1, $2, '2026-11-01', '2026-11-28', '2026-11-01', 0)`,
      [g.tenantId, m.id],
    );
    const page = value(await invoices({ memberId: m.id }, g.staff));
    expect(page.items[0]).toMatchObject({ lines: [], status: "paid", amountOwing: 0 });
  });

  it("returns an empty page for a member with no invoices", async () => {
    const g = await gym();
    const m = await member(g);
    expect(await invoices({ memberId: m.id }, g.staff)).toEqual({
      ok: true,
      value: { items: [], nextCursor: null },
    });
  });
});

describe("payments against Postgres", () => {
  it("lists newest first with who recorded each and the void flag and reason", async () => {
    const g = await gym();
    const m = await member(g);
    await pay(g, m.id, 5000, "2026-10-02");
    await pay(g, m.id, 4000, "2026-11-02", [], "Wrong member");
    const first = value(await payments({ memberId: m.id, limit: 1 }, g.staff));
    expect(first.items).toEqual([
      expect.objectContaining({
        amount: 4000,
        method: "cash",
        paidOn: "2026-11-02",
        recordedByName: "Sam Staff",
        isVoid: true,
        voidReason: "Wrong member",
      }),
    ]);
    expect(first.items[0]?.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    const second = value(
      await payments({ memberId: m.id, limit: 1, cursor: first.nextCursor }, g.staff),
    );
    expect(second.items[0]).toMatchObject({ amount: 5000, isVoid: false, voidReason: null });
    expect(second.nextCursor).toBeNull();
  });
});

describe("discounts against Postgres", () => {
  it("shows kind, amount, cadence, who referred and a derived status", async () => {
    const g = await gym();
    const m = await member(g, "Newcomer");
    const referrer = await member(g, "Grace Hopper");
    const spent = await invoice(g, m.id, "2026-11-01", 5000);
    await db.admin.query(
      `INSERT INTO member_discounts (tenant_id, member_id, kind, referral_side, source_member_id,
                                     amount, is_recurring, starts_on)
       VALUES ($1, $2, 'referral', 'referred', $3, 500, false, '2026-11-01')`,
      [g.tenantId, m.id, referrer.id],
    );
    await db.admin.query(
      `UPDATE member_discounts SET consumed_invoice_id = $2 WHERE tenant_id = $1`,
      [g.tenantId, spent],
    );
    await db.admin.query(
      `INSERT INTO member_discounts (tenant_id, member_id, kind, amount, is_recurring, reason, starts_on)
       VALUES ($1, $2, 'manual', 700, true, 'Student', '2026-10-01')`,
      [g.tenantId, m.id],
    );
    await db.admin.query(
      `INSERT INTO member_discounts (tenant_id, member_id, kind, amount, is_recurring, reason, starts_on, ends_on)
       VALUES ($1, $2, 'manual', 300, true, 'Promo', '2026-09-01', '2026-10-31')`,
      [g.tenantId, m.id],
    );

    const page = value(await discounts({ memberId: m.id, limit: 2 }, g.staff));
    expect(page.items).toEqual([
      expect.objectContaining({
        kind: "referral",
        referralSide: "referred",
        sourceMemberName: "Grace Hopper",
        amount: 500,
        isRecurring: false,
        status: "consumed",
        consumedInvoiceId: spent,
      }),
      expect.objectContaining({
        kind: "manual",
        reason: "Student",
        amount: 700,
        isRecurring: true,
        sourceMemberName: null,
        status: "active",
      }),
    ]);
    const rest = value(
      await discounts({ memberId: m.id, limit: 2, cursor: page.nextCursor }, g.staff),
    );
    expect(rest.items).toEqual([expect.objectContaining({ reason: "Promo", status: "ended" })]);
    expect(rest.nextCursor).toBeNull();
  });
});

describe("membership history against Postgres", () => {
  it("lists every period newest first with plan, dates and reason", async () => {
    const g = await gym();
    const m = await member(g);
    await db.admin.query(
      "UPDATE membership_periods SET valid_to = '2026-10-15' WHERE tenant_id = $1 AND member_id = $2",
      [g.tenantId, m.id],
    );
    await db.admin.query(
      `INSERT INTO membership_periods (tenant_id, member_id, plan_id, status, valid_from, valid_to, reason)
       VALUES ($1, $2, $3, 'paused', '2026-10-15', '2026-11-01', 'Injury'),
              ($1, $2, $3, 'active', '2026-11-01', NULL, NULL)`,
      [g.tenantId, m.id, g.planId],
    );
    const first = value(await history({ memberId: m.id, limit: 2 }, g.staff));
    expect(
      first.items.map((p) => [p.status, p.validFrom, p.validTo, p.reason, p.planName]),
    ).toEqual([
      ["active", "2026-11-01", null, null, "Default"],
      ["paused", "2026-10-15", "2026-11-01", "Injury", "Default"],
    ]);
    const second = value(
      await history({ memberId: m.id, limit: 2, cursor: first.nextCursor }, g.staff),
    );
    expect(second.items.map((p) => [p.status, p.validFrom, p.validTo])).toEqual([
      ["active", "2026-09-01", "2026-10-15"],
    ]);
    expect(second.nextCursor).toBeNull();
  });
});

describe("who can read what", () => {
  it("lets a member read their own four lists", async () => {
    const g = await gym();
    const m = await member(g);
    await invoice(g, m.id, "2026-11-01", 5000);
    await pay(g, m.id, 1000, "2026-11-02");
    expect(value(await invoices({ memberId: m.id }, m.self)).items).toHaveLength(1);
    expect(value(await payments({ memberId: m.id }, m.self)).items).toHaveLength(1);
    expect(value(await discounts({ memberId: m.id }, m.self)).items).toHaveLength(0);
    expect(value(await history({ memberId: m.id }, m.self)).items).toHaveLength(1);
  });

  it("shows a member nothing of another member of the same gym", async () => {
    const g = await gym();
    const mine = await member(g);
    const theirs = await member(g, "Someone Else");
    await invoice(g, theirs.id, "2026-11-01", 5000);
    for (const list of [invoices, payments, discounts, history]) {
      expect(await list({ memberId: theirs.id }, mine.self)).toMatchObject({
        ok: false,
        error: { kind: "not_found" },
      });
    }
  });

  it("shows another gym's staff nothing, and the store itself returns no rows across gyms", async () => {
    const a = await gym();
    const b = await gym();
    const m = await member(a);
    const bill = await invoice(a, m.id, "2026-11-01", 5000);
    await pay(a, m.id, 1000, "2026-11-02", [{ id: bill, amount: 1000 }]);
    for (const list of [invoices, payments, discounts, history]) {
      expect(await list({ memberId: m.id }, b.owner)).toMatchObject({
        ok: false,
        error: { kind: "not_found" },
      });
    }
    // Even with the check bypassed, a transaction of gym B cannot read gym A's rows.
    const page = { limit: 10, after: null };
    const rows = await withLedger(b.tenantId, async (unit) => ({
      invoices: await unit.ledger.invoices(m.id, page),
      payments: await unit.ledger.payments(m.id, page),
      discounts: await unit.ledger.discounts(m.id, page),
      periods: await unit.ledger.periods(m.id, page),
    }));
    expect(rows).toEqual({ invoices: [], payments: [], discounts: [], periods: [] });
  });

  it("lets staff of the gym read any of its members", async () => {
    const g = await gym();
    const m = await member(g);
    await invoice(g, m.id, "2026-11-01", 5000);
    expect(value(await invoices({ memberId: m.id }, g.staff)).items).toHaveLength(1);
  });
});
