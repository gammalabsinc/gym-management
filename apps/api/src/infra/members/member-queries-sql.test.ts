import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeGetMember, makeListMembers } from "../../app/member-queries";
import type { MemberQueryUnit, WithTenantTx } from "../../app/ports";
import type { MembershipStatus } from "../../domain/standing";
import { standingOf } from "../../domain/standing";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { makeWithTenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { likePattern } from "./member-queries-sql";
import { makeWithMemberQueryUnit } from "./member-queries-unit";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
/** Morning of 16 November in Toronto. */
const NOW = new Date("2026-11-16T15:00:00.000Z");
const TODAY = "2026-11-16";
const CLOCK = { now: () => NOW };

/** The date `days` days from a YYYY-MM-DD date, forwards or backwards. */
function addDays(text: string, days: number): string {
  const date = new Date(`${text}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

let db: TestDatabase;
let source: DataSource;
let withUnit: WithTenantTx<MemberQueryUnit>;
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
  withUnit = makeWithMemberQueryUnit(makeWithTenantTx(source));
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
  planId: string;
  caller: { roles: readonly ["staff"]; tenantId: string };
  recorderId: string;
}

async function gym(settings: { warn: number; red: number } = { warn: 5, red: 5 }): Promise<Gym> {
  counter += 1;
  const tenantId = await one(
    `INSERT INTO tenants (name, subdomain, timezone, currency, settings)
     VALUES ($1, $1, 'America/Toronto', 'CAD', $2::jsonb) RETURNING id`,
    [
      `gym-${counter}`,
      JSON.stringify({ warn_days_before: settings.warn, red_days_after: settings.red }),
    ],
  );
  const planId = await one(
    "INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee) VALUES ($1, 'default', 'Default', 2000, 5000) RETURNING id",
    [tenantId],
  );
  const recorderId = await one(
    "INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id",
    [tenantId, `staff-${counter}@example.test`],
  );
  return { tenantId, planId, caller: { roles: ["staff"], tenantId }, recorderId };
}

interface InvoiceSpec {
  /** Due date as days from today. */
  due: number;
  total?: number;
  paid?: number;
  voided?: boolean;
  /** The payment that paid it is void. */
  paymentVoid?: boolean;
}

interface MemberSpec {
  name?: string | null;
  email?: string;
  memberNo?: string;
  status?: MembershipStatus;
  invoices?: InvoiceSpec[];
  /** Payments with no invoice to use them, in minor units. */
  extraPayment?: number;
  /** Scan dates as days from today, and whether each is a duplicate. */
  scans?: { day: number; duplicate?: boolean }[];
}

async function addMember(g: Gym, spec: MemberSpec = {}): Promise<string> {
  counter += 1;
  const email = spec.email ?? `member-${counter}@example.test`;
  const name = spec.name === undefined ? `Member ${counter}` : spec.name;
  const userId = await one(
    "INSERT INTO users (tenant_id, email, name) VALUES ($1, $2, $3) RETURNING id",
    [g.tenantId, email, name],
  );
  const memberNo = spec.memberNo ?? `Q${String(counter).padStart(5, "0")}`;
  const memberId = await one(
    "INSERT INTO members (tenant_id, user_id, member_no, barcode, billing_day) VALUES ($1, $2, $3, $4, 1) RETURNING id",
    [g.tenantId, userId, memberNo, `R${String(counter).padStart(5, "0")}`],
  );
  const status = spec.status ?? "active";
  await db.admin.query(
    "INSERT INTO membership_periods (tenant_id, member_id, plan_id, status, valid_from, reason) VALUES ($1, $2, $3, $4, '2026-01-01', $5)",
    [g.tenantId, memberId, g.planId, status, status === "active" ? null : "test"],
  );
  for (const invoice of spec.invoices ?? []) await addInvoice(g, memberId, invoice);
  if (spec.extraPayment !== undefined) await addPayment(g, memberId, spec.extraPayment, false);
  for (const scan of spec.scans ?? []) {
    const date = addDays(TODAY, scan.day);
    await db.admin.query(
      `INSERT INTO attendance (tenant_id, member_id, scanned_at, local_date, is_duplicate, status_at_scan, source)
       VALUES ($1, $2, $3::date + time '12:00', $3::date, $4, 'paid', 'staff_app')`,
      [g.tenantId, memberId, date, scan.duplicate ?? false],
    );
  }
  return memberId;
}

async function addPayment(
  g: Gym,
  memberId: string,
  amount: number,
  isVoid: boolean,
): Promise<string> {
  return one(
    `INSERT INTO payments (tenant_id, member_id, amount, method, paid_on, recorded_by, client_request_id,
                           is_void, void_reason, voided_by, voided_at)
     VALUES ($1, $2, $3, 'cash', '2026-11-01', $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      g.tenantId,
      memberId,
      amount,
      g.recorderId,
      randomUUID(),
      isVoid,
      isVoid ? "test" : null,
      isVoid ? g.recorderId : null,
      isVoid ? NOW : null,
    ],
  );
}

async function addInvoice(g: Gym, memberId: string, spec: InvoiceSpec): Promise<void> {
  const due = addDays(TODAY, spec.due);
  const total = spec.total ?? 5000;
  const invoiceId = await one(
    `INSERT INTO invoices (tenant_id, member_id, period_start, period_end, due_date, total,
                           is_void, void_reason, voided_by, voided_at)
     VALUES ($1, $2, $3::date, $3::date + 29, $3::date, $4, $5, $6, $7, $8) RETURNING id`,
    [
      g.tenantId,
      memberId,
      due,
      total,
      spec.voided ?? false,
      spec.voided ? "test" : null,
      spec.voided ? g.recorderId : null,
      spec.voided ? NOW : null,
    ],
  );
  if (spec.paid !== undefined && spec.paid > 0) {
    const paymentId = await addPayment(g, memberId, spec.paid, false);
    await db.admin.query(
      "INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, amount) VALUES ($1, $2, $3, $4)",
      [g.tenantId, paymentId, invoiceId, spec.paid],
    );
    if (spec.paymentVoid) {
      await db.admin.query(
        "UPDATE payments SET is_void = true, void_reason = 'test', voided_by = $2, voided_at = now() WHERE id = $1",
        [paymentId, g.recorderId],
      );
    }
  }
}

const getter = () => makeGetMember({ withUnit, clock: CLOCK });
const lister = () => makeListMembers({ withUnit, clock: CLOCK });

async function profile(g: Gym, memberId: string) {
  const result = await getter()({ memberId }, g.caller);
  if (!result.ok) throw new Error(`expected a member, got ${result.error.message}`);
  return result.value;
}

describe("derived fields of one member", () => {
  it("reads the stored fields, the plan and the dates", async () => {
    const g = await gym();
    const id = await addMember(g, {
      name: "Ada Lovelace",
      email: "ada@example.test",
      memberNo: "ADA001",
    });
    expect(await profile(g, id)).toMatchObject({
      id,
      memberNo: "ADA001",
      name: "Ada Lovelace",
      email: "ada@example.test",
      phone: null,
      status: "active",
      plan: { key: "default", monthlyFee: 5000, admissionFee: 2000, isActive: true },
      joinedOn: "2026-01-01",
      leftOn: null,
      billingDay: 1,
      referredBy: null,
      standing: "paid",
      balanceDue: 0,
      credit: 0,
      paidThrough: null,
    });
  });

  it("reports the end date of a cancelled membership", async () => {
    const g = await gym();
    const id = await addMember(g, { status: "cancelled" });
    expect(await profile(g, id)).toMatchObject({
      status: "cancelled",
      leftOn: "2026-01-01",
      standing: "inactive",
    });
  });

  it("adds up balance due on invoices due today or earlier, and not on later ones", async () => {
    const g = await gym();
    const id = await addMember(g, {
      invoices: [
        { due: -40, paid: 5000 },
        { due: -10, total: 5000, paid: 2000 },
        { due: 0, total: 4000 },
        { due: 20, total: 5000 },
        { due: -3, total: 9000, voided: true },
      ],
    });
    const member = await profile(g, id);
    expect(member.balanceDue).toBe(3000 + 4000);
    expect(member.standing).toBe("overdue");
  });

  it("gives paid through as the end of the last paid invoice before the first unpaid one", async () => {
    const g = await gym();
    const id = await addMember(g, {
      invoices: [
        { due: -60, paid: 5000 },
        { due: -30, paid: 5000 },
        { due: 0, total: 5000 },
        { due: 30, total: 5000, paid: 5000 },
      ],
    });
    expect((await profile(g, id)).paidThrough).toBe(addDays(TODAY, -30 + 29));
    const allPaid = await addMember(g, {
      invoices: [
        { due: -30, paid: 5000 },
        { due: 0, paid: 5000 },
      ],
    });
    expect((await profile(g, allPaid)).paidThrough).toBe(addDays(TODAY, 29));
  });

  it("counts total paid on the invoice whose cycle holds today", async () => {
    const g = await gym();
    const id = await addMember(g, {
      invoices: [
        { due: -30, paid: 5000 },
        { due: -10, total: 5000, paid: 3000 },
        { due: 20, paid: 5000 },
      ],
    });
    expect((await profile(g, id)).totalPaid).toBe(3000);
  });

  it("gives credit as payments that no live invoice has used", async () => {
    const g = await gym();
    const id = await addMember(g, { extraPayment: 1500, invoices: [{ due: -5, paid: 5000 }] });
    expect((await profile(g, id)).credit).toBe(1500);
  });

  it("does not count a voided payment or a voided invoice", async () => {
    const g = await gym();
    const id = await addMember(g, {
      invoices: [{ due: -5, total: 5000, paid: 5000, paymentVoid: true }],
    });
    const member = await profile(g, id);
    expect(member.balanceDue).toBe(5000);
    expect(member.credit).toBe(0);
    expect(member.totalPaid).toBe(0);
  });

  it("counts visits by the gym's month and leaves out duplicates", async () => {
    const g = await gym();
    const id = await addMember(g, {
      scans: [
        { day: 0 },
        { day: -5 },
        { day: -5, duplicate: true },
        { day: -15 },
        { day: -16 },
        { day: -17 },
        { day: -40 },
      ],
    });
    const member = await profile(g, id);
    expect(member.visitsThisMonth).toBe(3);
    expect(member.visitsLastMonth).toBe(3);
  });

  it("returns not found for an id that is not a member of this gym", async () => {
    const g = await gym();
    const result = await getter()({ memberId: randomUUID() }, g.caller);
    expect(!result.ok && result.error.kind).toBe("not_found");
  });
});

describe("standing in SQL matches the pure function", () => {
  const dueOffsets = [-12, -11, -6, -5, -1, 0, 1, 4, 5, 6, 10, 11, 40];
  const settingsTable = [
    { warn: 5, red: 5 },
    { warn: 0, red: 0 },
    { warn: 10, red: 2 },
  ];

  it.each(settingsTable)("agrees over a table of cases with warn %o", async (settings) => {
    const g = await gym(settings);
    const cases: { id: string; status: MembershipStatus; invoices: InvoiceSpec[] }[] = [];
    for (const status of ["active", "paused", "cancelled"] as const) {
      const variants: InvoiceSpec[][] = [
        [],
        ...dueOffsets.map((due) => [{ due }]),
        ...dueOffsets.map((due) => [{ due, paid: 5000 }]),
        ...dueOffsets.map((due) => [{ due, voided: true }]),
        [{ due: -30, paid: 5000 }, { due: 3 }],
        [{ due: 3 }, { due: -9 }, { due: -2, paid: 5000 }],
        [{ due: -9, total: 5000, paid: 2000 }],
        [{ due: -9, paid: 5000, paymentVoid: true }],
      ];
      for (const invoices of variants) {
        const id = await addMember(g, { status, invoices });
        cases.push({ id, status, invoices });
      }
    }
    expect(cases.length).toBeGreaterThan(100);
    for (const c of cases) {
      const expected = standingOf({
        today: TODAY,
        warnDaysBefore: settings.warn,
        redDaysAfter: settings.red,
        membershipStatus: c.status,
        invoices: c.invoices.map((invoice) => {
          const counted = invoice.paid !== undefined && !invoice.paymentVoid ? invoice.paid : 0;
          return {
            dueDate: addDays(TODAY, invoice.due),
            amountDue: (invoice.total ?? 5000) - counted,
            isVoid: invoice.voided ?? false,
          };
        }),
      });
      if (!expected.ok) throw new Error("the pure function refused a case");
      const actual = await profile(g, c.id);
      expect({ standing: actual.standing, case: c }).toEqual({ standing: expected.value, case: c });
    }
  });
});

describe("the member list", () => {
  async function pageOf(
    g: Gym,
    input: { search?: string; limit?: number; cursor?: string | null },
  ) {
    const result = await lister()(input, g.caller);
    if (!result.ok) throw new Error(`expected a page, got ${result.error.message}`);
    return result.value;
  }

  it("puts overdue first, then due soon, paid and inactive, then orders by name", async () => {
    const g = await gym();
    await addMember(g, { name: "Zed Paid", invoices: [{ due: 30 }] });
    await addMember(g, { name: "Amy Paid" });
    await addMember(g, { name: "Bob Overdue", invoices: [{ due: -20 }] });
    await addMember(g, { name: "Cat Soon", invoices: [{ due: 3 }] });
    await addMember(g, { name: "Dan Inactive", status: "paused" });
    await addMember(g, { name: "Abe Overdue", invoices: [{ due: -9 }] });
    const page = await pageOf(g, {});
    expect(page.items.map((item) => item.name)).toEqual([
      "Abe Overdue",
      "Bob Overdue",
      "Cat Soon",
      "Amy Paid",
      "Zed Paid",
      "Dan Inactive",
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it("walks every member exactly once with cursor pagination", async () => {
    const g = await gym();
    const names: string[] = [];
    for (let n = 0; n < 11; n += 1) {
      const name = `Member ${String(n).padStart(2, "0")}`;
      names.push(name);
      await addMember(g, { name, invoices: n % 3 === 0 ? [{ due: -20 }] : [] });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Awaited<ReturnType<typeof pageOf>> = await pageOf(g, { limit: 4, cursor });
      expect(page.items.length).toBeLessThanOrEqual(4);
      seen.push(...page.items.map((item) => item.name ?? ""));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(11);
    expect([...seen].sort()).toEqual([...names].sort());
    expect(seen.slice(0, 4).every((name) => Number(name.slice(-2)) % 3 === 0)).toBe(true);
  });

  it("orders members with no name by email and keeps a stable order for equal names", async () => {
    const g = await gym();
    await addMember(g, { name: null, email: "beta@example.test" });
    await addMember(g, { name: null, email: "alpha@example.test" });
    await addMember(g, { name: "Twin" });
    await addMember(g, { name: "Twin" });
    const first = await pageOf(g, {});
    expect(first.items.map((item) => item.email).slice(0, 2)).toEqual([
      "alpha@example.test",
      "beta@example.test",
    ]);
    const twice = await pageOf(g, { limit: 3 });
    const rest = await pageOf(g, { limit: 3, cursor: twice.nextCursor });
    expect([...twice.items, ...rest.items].map((item) => item.id)).toEqual(
      first.items.map((item) => item.id),
    );
  });

  it("holds the page size to the hard maximum", async () => {
    const g = await gym();
    await addMember(g);
    const page = await pageOf(g, { limit: 1_000_000 });
    expect(page.items).toHaveLength(1);
  });

  it("searches name, email and member number, case blind", async () => {
    const g = await gym();
    const ada = await addMember(g, {
      name: "Ada Lovelace",
      email: "first@example.test",
      memberNo: "AAA111",
    });
    const grace = await addMember(g, {
      name: "Grace",
      email: "ada.fan@example.test",
      memberNo: "BBB222",
    });
    const third = await addMember(g, {
      name: "Third",
      email: "third@example.test",
      memberNo: "ADA999",
    });
    await addMember(g, { name: "Nobody", email: "none@example.test", memberNo: "CCC333" });
    const byAll = await pageOf(g, { search: "ada" });
    expect(byAll.items.map((item) => item.id).sort()).toEqual([ada, grace, third].sort());
    const upper = await pageOf(g, { search: "ADA" });
    expect(upper.items.map((item) => item.id).sort()).toEqual([ada, grace, third].sort());
    const byNumber = await pageOf(g, { search: "bbb2" });
    expect(byNumber.items.map((item) => item.id)).toEqual([grace]);
  });

  it("treats percent, underscore, quotes and backslashes as plain text", async () => {
    const g = await gym();
    const plain = await addMember(g, { name: "Plain Name" });
    const percent = await addMember(g, { name: "100% Effort" });
    const quote = await addMember(g, { name: "O'Brien; DROP TABLE members;--" });
    const slash = await addMember(g, { name: "Back\\slash" });
    const under = await addMember(g, { name: "snake_case" });
    expect((await pageOf(g, { search: "%" })).items.map((item) => item.id)).toEqual([percent]);
    expect((await pageOf(g, { search: "_" })).items.map((item) => item.id)).toEqual([under]);
    expect((await pageOf(g, { search: "'" })).items.map((item) => item.id)).toEqual([quote]);
    expect((await pageOf(g, { search: "\\" })).items.map((item) => item.id)).toEqual([slash]);
    expect((await pageOf(g, { search: "plain" })).items.map((item) => item.id)).toEqual([plain]);
    expect((await pageOf(g, { search: "' OR 1=1 --" })).items).toEqual([]);
    expect((await pageOf(g, {})).items).toHaveLength(5);
  });

  it("shows no member of another gym, and refuses to read one by id", async () => {
    const a = await gym();
    const b = await gym();
    const inA = await addMember(a, { name: "Only In A", invoices: [{ due: -20 }] });
    await addMember(b, { name: "Only In B" });
    expect((await pageOf(a, {})).items.map((item) => item.name)).toEqual(["Only In A"]);
    expect((await pageOf(b, {})).items.map((item) => item.name)).toEqual(["Only In B"]);
    expect((await pageOf(b, { search: "Only In A" })).items).toEqual([]);
    const result = await getter()({ memberId: inA }, b.caller);
    expect(!result.ok && result.error.kind).toBe("not_found");
  });
});

describe("likePattern", () => {
  it("escapes the characters LIKE treats as wildcards", () => {
    expect(likePattern("a%b_c\\d")).toBe("%a\\%b\\_c\\\\d%");
  });
});
