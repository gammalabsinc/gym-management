import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCreateMember } from "../../app/create-member";
import { makeGetMember } from "../../app/member-queries";
import type { MemberQueryUnit, MemberUnit, PaymentUnit, WithTenantTx } from "../../app/ports";
import { makePreviewPayment, type PreviewPaymentContext } from "../../app/preview-payment";
import { makeRecordPayment } from "../../app/record-payment";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { makeWithTenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { randomCodes } from "../members/member-codes";
import { makeWithMemberQueryUnit } from "../members/member-queries-unit";
import { makeWithMemberUnit } from "../members/members-unit";
import { makeWithPaymentUnit } from "./payments-unit";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
/** Morning of 16 November in Toronto. */
const NOW = new Date("2026-11-16T15:00:00.000Z");
const CLOCK = { now: () => NOW };

let db: TestDatabase;
let source: DataSource;
let withMember: WithTenantTx<MemberUnit>;
let withPayment: WithTenantTx<PaymentUnit>;
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
  readonly ctx: PreviewPaymentContext;
}

/** A gym with one staff user and the default plan: 2000 to join and 5000 a month. */
async function gym(): Promise<Gym> {
  counter += 1;
  const tenantId = await one(
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $1, 'America/Toronto', 'CAD') RETURNING id",
    [`preview-gym-${counter}`],
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

async function member(g: Gym, joinDate: string): Promise<string> {
  counter += 1;
  const created = await makeCreateMember({
    withUnit: withMember,
    clock: CLOCK,
    codes: randomCodes,
  })({ fullName: "Ada Lovelace", email: `ada-${counter}@example.test`, joinDate }, g.ctx);
  if (!created.ok) throw new Error(`expected a member, got ${created.error.message}`);
  return created.value.memberId;
}

const preview = makePreviewPayment({ withUnit: (t, fn) => withPayment(t, fn), clock: CLOCK });
const record = makeRecordPayment({ withUnit: (t, fn) => withPayment(t, fn), clock: CLOCK });
const getMember = makeGetMember({ withUnit: (t, fn) => withQueries(t, fn), clock: CLOCK });

async function pay(g: Gym, memberId: string, amount: number) {
  const result = await record(
    { clientRequestId: randomUUID(), memberId, amount, method: "cash" },
    g.ctx,
  );
  if (!result.ok) throw new Error(`expected a payment, got ${result.error.message}`);
  return result.value;
}

/** Every table a payment or an invoice can write to, so a preview that wrote anything shows. */
async function rowCounts(tenantId: string): Promise<Record<string, number>> {
  const tables = ["invoices", "invoice_lines", "payments", "payment_allocations", "audit_events"];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const { rows } = await db.admin.query(
      `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
      [tenantId],
    );
    counts[table] = (rows[0] as { n: number }).n;
  }
  return counts;
}

async function periodStarts(invoiceIds: readonly string[]): Promise<Map<string, string>> {
  const { rows } = await db.admin.query(
    "SELECT id, to_char(period_start, 'YYYY-MM-DD') AS period_start FROM invoices WHERE id = ANY($1::uuid[])",
    [invoiceIds],
  );
  return new Map(
    (rows as { id: string; period_start: string }[]).map((r) => [r.id, r.period_start]),
  );
}

interface Scenario {
  readonly name: string;
  readonly joinDate: string;
  /** Payments made before the preview. */
  readonly earlier?: readonly number[];
  /** Left out to preview the suggested amount. */
  readonly amount?: number;
}

/** The shared test table: each row is previewed and then really recorded, and the two must agree. */
const SCENARIOS: readonly Scenario[] = [
  { name: "the exact first invoice", joinDate: "2026-11-16", amount: 7000 },
  { name: "part of the first invoice", joinDate: "2026-11-10", amount: 3000 },
  {
    name: "the first invoice and one ahead, with credit left",
    joinDate: "2026-11-10",
    amount: 13000,
  },
  {
    name: "so much that the twelve cycles ahead are all built",
    joinDate: "2026-11-10",
    amount: 100000,
  },
  { name: "three unpaid cycles, two and a part paid", joinDate: "2026-09-10", amount: 15000 },
  {
    name: "part of the next cycle after an earlier payment",
    joinDate: "2026-10-10",
    earlier: [7000],
    amount: 2000,
  },
  {
    name: "an earlier payment that left part of a cycle open",
    joinDate: "2026-10-10",
    earlier: [9000],
    amount: 3000,
  },
  {
    name: "a member who is paid up, paying ahead",
    joinDate: "2026-11-10",
    earlier: [7000],
    amount: 6000,
  },
  { name: "the suggested amount, two cycles owed", joinDate: "2026-10-10" },
  { name: "the suggested amount, one cycle owed", joinDate: "2026-11-10", earlier: [2000] },
];

describe("previewing a payment against Postgres", () => {
  it.each(SCENARIOS)("gives the allocations the real payment gives: $name", async (scenario) => {
    const g = await gym();
    const memberId = await member(g, scenario.joinDate);
    for (const amount of scenario.earlier ?? []) await pay(g, memberId, amount);

    const before = await rowCounts(g.ctx.tenantId);
    const previewed = await preview({ memberId, amount: scenario.amount }, g.ctx);
    if (!previewed.ok) throw new Error(`expected a preview, got ${previewed.error.message}`);
    expect(await rowCounts(g.ctx.tenantId)).toEqual(before);

    const real = await pay(g, memberId, previewed.value.amount);
    const starts = await periodStarts(real.allocations.map((a) => a.invoiceId));
    expect(
      previewed.value.allocations.map((a) => ({ periodStart: a.periodStart, amount: a.amount })),
    ).toEqual(
      real.allocations.map((a) => ({ periodStart: starts.get(a.invoiceId), amount: a.amount })),
    );
    // An invoice that already existed keeps its id, one the payment built has none yet.
    const existing = new Set(
      (
        await db.admin.query("SELECT id FROM invoices WHERE tenant_id = $1", [g.ctx.tenantId])
      ).rows.map((r) => (r as { id: string }).id),
    );
    for (const allocation of previewed.value.allocations) {
      if (allocation.invoiceId !== null) expect(existing.has(allocation.invoiceId)).toBe(true);
    }
    expect(previewed.value.creditAfter).toBe(real.credit);

    const after = await getMember({ memberId }, g.ctx);
    if (!after.ok) throw new Error("expected the member");
    expect(previewed.value.paidThroughAfter).toBe(after.value.paidThrough);
  });

  it("suggests what the member owes", async () => {
    const g = await gym();
    const memberId = await member(g, "2026-10-10");
    const result = await preview({ memberId }, g.ctx);
    expect(result.ok && result.value).toMatchObject({ suggestedAmount: 12000, amount: 12000 });
  });

  it("builds an invoice that is due but was never generated, in memory only", async () => {
    const g = await gym();
    // The member joined a month ago, so the invoice of the cycle that holds today was never built.
    const earlier = new Date("2026-10-12T15:00:00.000Z");
    counter += 1;
    const created = await makeCreateMember({
      withUnit: withMember,
      clock: { now: () => earlier },
      codes: randomCodes,
    })(
      { fullName: "Grace Hopper", email: `grace-${counter}@example.test`, joinDate: "2026-10-10" },
      g.ctx,
    );
    if (!created.ok) throw new Error(`expected a member, got ${created.error.message}`);
    const { memberId } = created.value;

    const before = await rowCounts(g.ctx.tenantId);
    const previewed = await preview({ memberId, amount: 9000 }, g.ctx);
    if (!previewed.ok) throw new Error(`expected a preview, got ${previewed.error.message}`);
    expect(await rowCounts(g.ctx.tenantId)).toEqual(before);
    expect(previewed.value.allocations).toEqual([
      expect.objectContaining({
        periodStart: "2026-10-10",
        amount: 7000,
        invoiceId: expect.any(String),
      }),
      { invoiceId: null, periodStart: "2026-11-10", periodEnd: "2026-12-09", amount: 2000 },
    ]);

    const real = await pay(g, memberId, 9000);
    const starts = await periodStarts(real.allocations.map((a) => a.invoiceId));
    expect(real.allocations.map((a) => [starts.get(a.invoiceId), a.amount])).toEqual([
      ["2026-10-10", 7000],
      ["2026-11-10", 2000],
    ]);
  });

  it("is refused for an amount a payment would refuse", async () => {
    const g = await gym();
    const memberId = await member(g, "2026-11-10");
    for (const amount of [0, -5, 10.5]) {
      const result = await preview({ memberId, amount }, g.ctx);
      expect(!result.ok && result.error.kind).toBe("validation");
    }
  });

  describe("across gyms", () => {
    it("cannot reach another gym's member, and sees none of its invoices", async () => {
      const a = await gym();
      const b = await gym();
      const memberA = await member(a, "2026-11-10");
      const crossed = await preview({ memberId: memberA, amount: 5000 }, b.ctx);
      expect(!crossed.ok && crossed.error.kind).toBe("not_found");
      const seen = await withPayment(b.ctx.tenantId, (unit) => unit.payments.ledger(memberA));
      expect(seen).toEqual([]);
    });
  });
});
