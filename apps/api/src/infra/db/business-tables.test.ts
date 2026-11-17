import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeDataSource } from "./data-source";
import { migrateDatabase } from "./migrate";
import { findUnprotectedTenantTables } from "./rls-guard";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "./roles";
import { TENANT_SETTING } from "./tenant-tx";
import { createTestDatabase, type TestDatabase } from "./test-database";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
const UNIQUE_VIOLATION = "23505";
const FK_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const EXCLUSION_VIOLATION = "23P01";
const INSUFFICIENT_PRIVILEGE = "42501";

const BUSINESS_TABLES = [
  "attendance",
  "invoice_lines",
  "invoices",
  "member_discounts",
  "members",
  "membership_periods",
  "payment_allocations",
  "payments",
  "plans",
];

let db: TestDatabase;
/** The superuser sets up fixtures across tenants. Row level security is tested further down. */
let admin: pg.Client;
let app: pg.Client;

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  admin = db.admin;
  app = await db.connect(APP_ROLE, PASSWORDS.appPassword);
});

afterAll(async () => {
  await app.end();
  await db.drop();
});

async function codeOf(attempt: Promise<unknown>): Promise<string | undefined> {
  try {
    await attempt;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

async function one(client: pg.Client, sql: string, params: unknown[]): Promise<string> {
  const { rows } = await client.query(sql, params);
  return (rows[0] as { id: string }).id;
}

let counter = 0;
const next = () => {
  counter += 1;
  return counter;
};

/** A member code is six characters of A to Z and 0 to 9, and must be unique across every gym. */
const memberNo = () => `M${String(next()).padStart(5, "0")}`;

interface Gym {
  tenantId: string;
  userId: string;
  planId: string;
}

async function gym(): Promise<Gym> {
  const n = next();
  const tenantId = await one(
    admin,
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $1, 'America/Toronto', 'CAD') RETURNING id",
    [`gym-${n}`],
  );
  const userId = await one(
    admin,
    "INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id",
    [tenantId, `staff-${n}@example.test`],
  );
  const planId = await one(
    admin,
    "INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee) VALUES ($1, 'default', 'Default', 2000, 5000) RETURNING id",
    [tenantId],
  );
  return { tenantId, userId, planId };
}

async function member(g: Gym, overrides: { referredBy?: string | null } = {}): Promise<string> {
  const n = next();
  const memberUser = await one(
    admin,
    "INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id",
    [g.tenantId, `member-${n}@example.test`],
  );
  return one(
    admin,
    `INSERT INTO members (tenant_id, user_id, member_no, barcode, billing_day, referred_by)
     VALUES ($1, $2, $3, $4, 15, $5) RETURNING id`,
    [g.tenantId, memberUser, memberNo(), randomUUID(), overrides.referredBy ?? null],
  );
}

async function period(
  g: Gym,
  memberId: string,
  from: string,
  to: string | null,
  status = "active",
): Promise<string> {
  return one(
    admin,
    `INSERT INTO membership_periods (tenant_id, member_id, plan_id, status, valid_from, valid_to)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [g.tenantId, memberId, g.planId, status, from, to],
  );
}

async function invoice(
  g: Gym,
  memberId: string,
  start = "2026-11-15",
  total = 5000,
): Promise<string> {
  return one(
    admin,
    `INSERT INTO invoices (tenant_id, member_id, period_start, period_end, due_date, total)
     VALUES ($1, $2, $3, ($3::date + interval '1 month' - interval '1 day')::date, $3, $4) RETURNING id`,
    [g.tenantId, memberId, start, total],
  );
}

async function payment(g: Gym, memberId: string, amount = 5000): Promise<string> {
  return one(
    admin,
    `INSERT INTO payments (tenant_id, member_id, amount, method, paid_on, recorded_by, client_request_id)
     VALUES ($1, $2, $3, 'cash', '2026-11-15', $4, $5) RETURNING id`,
    [g.tenantId, memberId, amount, g.userId, randomUUID()],
  );
}

function allocate(g: Gym, paymentId: string, invoiceId: string, amount: number) {
  return admin.query(
    "INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, amount) VALUES ($1, $2, $3, $4)",
    [g.tenantId, paymentId, invoiceId, amount],
  );
}

function voidRow(table: "invoices" | "payments", g: Gym, id: string) {
  return admin.query(
    `UPDATE ${table} SET is_void = true, void_reason = 'mistake', voided_by = $1, voided_at = now() WHERE id = $2`,
    [g.userId, id],
  );
}

describe("plans", () => {
  it("keeps the key unique per gym, the fees non negative, and applies defaults", async () => {
    const a = await gym();
    const b = await gym();
    const insert = (g: Gym, key: string, admission: number, monthly: number) =>
      admin.query(
        "INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee) VALUES ($1, $2, 'P', $3, $4)",
        [g.tenantId, key, admission, monthly],
      );
    await insert(b, "extra", 0, 0);
    await insert(a, "extra", 0, 0);
    expect(await codeOf(insert(a, "default", 0, 0))).toBe(UNIQUE_VIOLATION);
    expect(await codeOf(insert(a, "x", -1, 0))).toBe(CHECK_VIOLATION);
    expect(await codeOf(insert(a, "y", 0, -1))).toBe(CHECK_VIOLATION);
    expect(await codeOf(insert(a, "", 0, 0))).toBe(CHECK_VIOLATION);
    const { rows } = await admin.query("SELECT is_active, meta FROM plans WHERE id = $1", [
      a.planId,
    ]);
    expect(rows[0]).toEqual({ is_active: true, meta: {} });
  });
});

describe("members", () => {
  const insert = (g: Gym, userId: string, no: string, barcode: string, day: number) =>
    admin.query(
      "INSERT INTO members (tenant_id, user_id, member_no, barcode, billing_day) VALUES ($1, $2, $3, $4, $5)",
      [g.tenantId, userId, no, barcode, day],
    );

  async function freshUser(g: Gym): Promise<string> {
    return one(admin, "INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id", [
      g.tenantId,
      `u-${next()}@example.test`,
    ]);
  }

  it("keeps member_no and barcode unique across every gym, not per gym", async () => {
    const a = await gym();
    const b = await gym();
    await insert(a, await freshUser(a), "AAA111", "bar-global", 1);
    expect(await codeOf(insert(b, await freshUser(b), "AAA111", "bar-other", 1))).toBe(
      UNIQUE_VIOLATION,
    );
    expect(await codeOf(insert(b, await freshUser(b), "BBB222", "bar-global", 1))).toBe(
      UNIQUE_VIOLATION,
    );
  });

  it("accepts only six characters of uppercase letters and digits as a member number", async () => {
    const a = await gym();
    for (const bad of ["abc123", "ABC12", "ABC1234", "ABC-12", ""]) {
      expect(await codeOf(insert(a, await freshUser(a), bad, randomUUID(), 1)), bad).toBe(
        CHECK_VIOLATION,
      );
    }
    await insert(a, await freshUser(a), "ZZ9900", randomUUID(), 1);
  });

  it("keeps the billing day between 1 and 31 and the barcode non empty", async () => {
    const a = await gym();
    expect(await codeOf(insert(a, await freshUser(a), "BD0001", randomUUID(), 0))).toBe(
      CHECK_VIOLATION,
    );
    expect(await codeOf(insert(a, await freshUser(a), "BD0032", randomUUID(), 32))).toBe(
      CHECK_VIOLATION,
    );
    expect(await codeOf(insert(a, await freshUser(a), "BD0002", "", 5))).toBe(CHECK_VIOLATION);
    await insert(a, await freshUser(a), "BD0031", randomUUID(), 31);
  });

  it("gives a user one member row per gym", async () => {
    const a = await gym();
    const userId = await freshUser(a);
    await insert(a, userId, "ONE001", randomUUID(), 3);
    expect(await codeOf(insert(a, userId, "ONE002", randomUUID(), 3))).toBe(UNIQUE_VIOLATION);
  });

  it("refuses a user of another gym", async () => {
    const a = await gym();
    const b = await gym();
    expect(await codeOf(insert(a, await freshUser(b), "XUSR01", randomUUID(), 3))).toBe(
      FK_VIOLATION,
    );
  });

  it("refuses a member who refers themselves, or a referrer from another gym", async () => {
    const a = await gym();
    const b = await gym();
    const referrer = await member(a);
    const referred = await member(a, { referredBy: referrer });
    const { rows } = await admin.query("SELECT referred_by FROM members WHERE id = $1", [referred]);
    expect(rows[0]).toEqual({ referred_by: referrer });
    expect(
      await codeOf(admin.query("UPDATE members SET referred_by = id WHERE id = $1", [referrer])),
    ).toBe(CHECK_VIOLATION);
    expect(await codeOf(member(b, { referredBy: referrer }))).toBe(FK_VIOLATION);
  });
});

describe("membership_periods", () => {
  it("allows only one current row per member, but one per member in each gym's members", async () => {
    const a = await gym();
    const m = await member(a);
    const other = await member(a);
    await period(a, m, "2026-01-01", null);
    // The unique index and the exclusion constraint both refuse it. Either is enough.
    expect([UNIQUE_VIOLATION, EXCLUSION_VIOLATION]).toContain(
      await codeOf(period(a, m, "2026-06-01", null)),
    );
    await period(a, other, "2026-01-01", null);
  });

  it("refuses overlapping periods of one member and allows back to back ones", async () => {
    const a = await gym();
    const m = await member(a);
    await period(a, m, "2026-01-01", "2026-03-01");
    expect(await codeOf(period(a, m, "2026-02-15", "2026-04-01"))).toBe(EXCLUSION_VIOLATION);
    expect(await codeOf(period(a, m, "2026-02-01", null))).toBe(EXCLUSION_VIOLATION);
    await period(a, m, "2026-03-01", "2026-05-01", "paused");
    await period(a, m, "2026-05-01", null);
    // A different member of the same gym can cover the same dates.
    await period(a, await member(a), "2026-02-01", "2026-04-01");
  });

  it("checks the status, the date range, and that the plan and member belong to the same gym", async () => {
    const a = await gym();
    const b = await gym();
    const m = await member(a);
    expect(await codeOf(period(a, m, "2026-01-01", null, "frozen"))).toBe(CHECK_VIOLATION);
    expect(await codeOf(period(a, m, "2026-02-01", "2026-01-01"))).toBe(CHECK_VIOLATION);
    await period(a, m, "2026-03-01", "2026-03-01", "cancelled");
    expect(await codeOf(period({ ...a, planId: b.planId }, m, "2026-04-01", null))).toBe(
      FK_VIOLATION,
    );
  });

  it("can only be updated by closing it with a valid_to", async () => {
    const a = await gym();
    const m = await member(a);
    const id = await period(a, m, "2026-01-01", null);
    expect(await codeOf(app.query("DELETE FROM membership_periods WHERE id = $1", [id]))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
    expect(
      await codeOf(
        admin.query("UPDATE membership_periods SET status = 'paused' WHERE id = $1", [id]),
      ),
    ).toBe(CHECK_VIOLATION);
    await admin.query("UPDATE membership_periods SET valid_to = '2026-02-01' WHERE id = $1", [id]);
    expect(
      await codeOf(
        admin.query("UPDATE membership_periods SET valid_to = '2026-03-01' WHERE id = $1", [id]),
      ),
    ).toBe(CHECK_VIOLATION);
  });
});

describe("invoices", () => {
  it("allows one live invoice per member and cycle, but a voided one can be replaced", async () => {
    const a = await gym();
    const m = await member(a);
    const first = await invoice(a, m);
    expect(await codeOf(invoice(a, m))).toBe(UNIQUE_VIOLATION);
    await voidRow("invoices", a, first);
    await invoice(a, m);
    await invoice(a, await member(a));
  });

  it("checks the total, the cycle dates, and that the due date is the first day of the cycle", async () => {
    const a = await gym();
    const m = await member(a);
    const insert = (start: string, end: string, due: string, total: number) =>
      admin.query(
        "INSERT INTO invoices (tenant_id, member_id, period_start, period_end, due_date, total) VALUES ($1, $2, $3, $4, $5, $6)",
        [a.tenantId, m, start, end, due, total],
      );
    expect(await codeOf(insert("2026-11-15", "2026-12-14", "2026-11-15", -1))).toBe(
      CHECK_VIOLATION,
    );
    expect(await codeOf(insert("2026-11-15", "2026-11-14", "2026-11-15", 0))).toBe(CHECK_VIOLATION);
    expect(await codeOf(insert("2026-11-15", "2026-12-14", "2026-11-20", 0))).toBe(CHECK_VIOLATION);
    await insert("2026-11-15", "2026-12-14", "2026-11-15", 0);
  });

  it("sets the void columns together or not at all", async () => {
    const a = await gym();
    const id = await invoice(a, await member(a));
    expect(
      await codeOf(admin.query("UPDATE invoices SET is_void = true WHERE id = $1", [id])),
    ).toBe(CHECK_VIOLATION);
    expect(
      await codeOf(admin.query("UPDATE invoices SET void_reason = 'oops' WHERE id = $1", [id])),
    ).toBe(CHECK_VIOLATION);
    await voidRow("invoices", a, id);
    const { rows } = await admin.query("SELECT is_void, void_reason FROM invoices WHERE id = $1", [
      id,
    ]);
    expect(rows[0]).toEqual({ is_void: true, void_reason: "mistake" });
  });

  it("is never edited, only voided, and never deleted", async () => {
    const a = await gym();
    const id = await invoice(a, await member(a));
    expect(await codeOf(app.query("DELETE FROM invoices WHERE id = $1", [id]))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
    expect(await codeOf(admin.query("UPDATE invoices SET total = 1 WHERE id = $1", [id]))).toBe(
      CHECK_VIOLATION,
    );
    expect(
      await codeOf(
        admin.query(
          "UPDATE invoices SET total = 1, is_void = true, void_reason = 'x', voided_at = now() WHERE id = $1",
          [id],
        ),
      ),
    ).toBe(CHECK_VIOLATION);
    await voidRow("invoices", a, id);
    // A voided invoice cannot be changed back or voided again.
    expect(
      await codeOf(
        admin.query(
          "UPDATE invoices SET is_void = false, void_reason = null, voided_by = null, voided_at = null WHERE id = $1",
          [id],
        ),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(await codeOf(voidRow("invoices", a, id))).toBe(CHECK_VIOLATION);
  });

  it("cannot be voided while a payment that is not void is allocated to it, until that payment is voided", async () => {
    const a = await gym();
    const m = await member(a);
    const inv = await invoice(a, m);
    const pay = await payment(a, m, 5000);
    await allocate(a, pay, inv, 5000);
    expect(await codeOf(voidRow("invoices", a, inv))).toBe(CHECK_VIOLATION);
    await voidRow("payments", a, pay);
    await voidRow("invoices", a, inv);
  });
});

describe("invoice_lines", () => {
  const insertLine = (g: Gym, invoiceId: string, type: string, amount: number, discount?: string) =>
    admin.query(
      "INSERT INTO invoice_lines (tenant_id, invoice_id, line_type, description, amount, discount_id) VALUES ($1, $2, $3, 'Line', $4, $5)",
      [g.tenantId, invoiceId, type, amount, discount ?? null],
    );

  it("takes positive fees as membership and admission lines and negative amounts as discount lines", async () => {
    const a = await gym();
    const m = await member(a);
    const inv = await invoice(a, m);
    const discount = await one(
      admin,
      "INSERT INTO member_discounts (tenant_id, member_id, kind, amount, is_recurring, reason, starts_on) VALUES ($1, $2, 'manual', 1000, true, 'loyal', '2026-01-01') RETURNING id",
      [a.tenantId, m],
    );
    await insertLine(a, inv, "membership", 5000);
    await insertLine(a, inv, "admission", 0);
    await insertLine(a, inv, "discount", -1000, discount);
    expect(await codeOf(insertLine(a, inv, "membership", -5))).toBe(CHECK_VIOLATION);
    expect(await codeOf(insertLine(a, inv, "discount", 1000, discount))).toBe(CHECK_VIOLATION);
    expect(await codeOf(insertLine(a, inv, "discount", 0, discount))).toBe(CHECK_VIOLATION);
    expect(await codeOf(insertLine(a, inv, "refund", 100))).toBe(CHECK_VIOLATION);
  });

  it("sets discount_id only on discount lines and only to a discount of the same gym", async () => {
    const a = await gym();
    const b = await gym();
    const m = await member(a);
    const inv = await invoice(a, m);
    const discount = await one(
      admin,
      "INSERT INTO member_discounts (tenant_id, member_id, kind, amount, is_recurring, reason, starts_on) VALUES ($1, $2, 'manual', 1000, true, 'loyal', '2026-01-01') RETURNING id",
      [a.tenantId, m],
    );
    expect(await codeOf(insertLine(a, inv, "membership", 100, discount))).toBe(CHECK_VIOLATION);
    const foreign = await one(
      admin,
      "INSERT INTO member_discounts (tenant_id, member_id, kind, amount, is_recurring, reason, starts_on) VALUES ($1, $2, 'manual', 1, true, 'x', '2026-01-01') RETURNING id",
      [b.tenantId, await member(b)],
    );
    expect(await codeOf(insertLine(a, inv, "discount", -100, foreign))).toBe(FK_VIOLATION);
  });

  it("is never updated or deleted by the app role", async () => {
    const a = await gym();
    const inv = await invoice(a, await member(a));
    await insertLine(a, inv, "membership", 5000);
    for (const sql of ["UPDATE invoice_lines SET amount = 1", "DELETE FROM invoice_lines"]) {
      expect(await codeOf(app.query(sql)), sql).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });
});

describe("payments", () => {
  const insert = (g: Gym, memberId: string, amount: number, method: string, request: string) =>
    admin.query(
      `INSERT INTO payments (tenant_id, member_id, amount, method, paid_on, recorded_by, client_request_id)
       VALUES ($1, $2, $3, $4, '2026-11-15', $5, $6)`,
      [g.tenantId, memberId, amount, method, g.userId, request],
    );

  it("checks the amount and the method", async () => {
    const a = await gym();
    const m = await member(a);
    expect(await codeOf(insert(a, m, 0, "cash", randomUUID()))).toBe(CHECK_VIOLATION);
    expect(await codeOf(insert(a, m, -5, "cash", randomUUID()))).toBe(CHECK_VIOLATION);
    expect(await codeOf(insert(a, m, 100, "cheque", randomUUID()))).toBe(CHECK_VIOLATION);
    for (const method of ["cash", "card", "bank_transfer"]) {
      await insert(a, m, 100, method, randomUUID());
    }
  });

  it("makes a repeated client_request_id unique within a gym only", async () => {
    const a = await gym();
    const b = await gym();
    const request = randomUUID();
    await insert(a, await member(a), 100, "cash", request);
    await insert(b, await member(b), 100, "cash", request);
    expect(await codeOf(insert(a, await member(a), 100, "cash", request))).toBe(UNIQUE_VIOLATION);
  });

  it("is never edited, only voided, and never deleted", async () => {
    const a = await gym();
    const id = await payment(a, await member(a));
    expect(await codeOf(app.query("DELETE FROM payments WHERE id = $1", [id]))).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
    expect(await codeOf(admin.query("UPDATE payments SET amount = 1 WHERE id = $1", [id]))).toBe(
      CHECK_VIOLATION,
    );
    await voidRow("payments", a, id);
    expect(await codeOf(voidRow("payments", a, id))).toBe(CHECK_VIOLATION);
    const { rows } = await admin.query("SELECT is_void FROM payments WHERE id = $1", [id]);
    expect(rows[0]).toEqual({ is_void: true });
  });

  it("requires the recorder to be a user of the same gym", async () => {
    const a = await gym();
    const b = await gym();
    expect(
      await codeOf(insert({ ...a, userId: b.userId }, await member(a), 100, "cash", randomUUID())),
    ).toBe(FK_VIOLATION);
  });
});

describe("payment_allocations", () => {
  it("never lets the allocations of one payment exceed its amount", async () => {
    const a = await gym();
    const m = await member(a);
    const pay = await payment(a, m, 5000);
    const one1 = await invoice(a, m, "2026-11-15", 3000);
    const two = await invoice(a, m, "2026-12-15", 3000);
    await allocate(a, pay, one1, 3000);
    expect(await codeOf(allocate(a, pay, two, 2001))).toBe(CHECK_VIOLATION);
    await allocate(a, pay, two, 2000);
  });

  it("never lets the counted allocations on one invoice exceed its total, and ignores void payments", async () => {
    const a = await gym();
    const m = await member(a);
    const inv = await invoice(a, m, "2026-11-15", 5000);
    const first = await payment(a, m, 4000);
    const second = await payment(a, m, 4000);
    await allocate(a, first, inv, 4000);
    expect(await codeOf(allocate(a, second, inv, 1001))).toBe(CHECK_VIOLATION);
    // Once the first payment is void its allocation no longer counts.
    await voidRow("payments", a, first);
    await allocate(a, second, inv, 4000);
    const third = await payment(a, m, 4000);
    expect(await codeOf(allocate(a, third, inv, 1001))).toBe(CHECK_VIOLATION);
    await allocate(a, third, inv, 1000);
  });

  it("does not count a void payment against the invoice when a new allocation is written to it", async () => {
    const a = await gym();
    const m = await member(a);
    const inv = await invoice(a, m, "2026-11-15", 1000);
    const live = await payment(a, m, 1000);
    const voided = await payment(a, m, 1000);
    await voidRow("payments", a, voided);
    await allocate(a, live, inv, 1000);
    await allocate(a, voided, inv, 1000);
  });

  it("checks the amount and refuses a payment or invoice of another gym", async () => {
    const a = await gym();
    const b = await gym();
    const m = await member(a);
    const pay = await payment(a, m, 1000);
    const inv = await invoice(a, m, "2026-11-15", 1000);
    expect(await codeOf(allocate(a, pay, inv, 0))).toBe(CHECK_VIOLATION);
    const foreignInvoice = await invoice(b, await member(b));
    expect(await codeOf(allocate(a, pay, foreignInvoice, 10))).toBe(FK_VIOLATION);
  });

  it("is never updated or deleted by the app role", async () => {
    for (const sql of [
      "UPDATE payment_allocations SET amount = 1",
      "DELETE FROM payment_allocations",
    ]) {
      expect(await codeOf(app.query(sql)), sql).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });
});

describe("member_discounts", () => {
  const insert = (g: Gym, memberId: string, fields: Record<string, unknown>) => {
    const row = {
      tenant_id: g.tenantId,
      member_id: memberId,
      kind: "manual",
      amount: 1000,
      is_recurring: false,
      reason: "goodwill",
      starts_on: "2026-11-15",
      ...fields,
    };
    const columns = Object.keys(row);
    const params = columns.map((_, i) => `$${i + 1}`);
    return admin.query(
      `INSERT INTO member_discounts (${columns.join(", ")}) VALUES (${params.join(", ")})`,
      Object.values(row),
    );
  };

  it("requires a reason for a manual discount and no referral fields", async () => {
    const a = await gym();
    const m = await member(a);
    const source = await member(a);
    await insert(a, m, {});
    expect(await codeOf(insert(a, m, { reason: null }))).toBe(CHECK_VIOLATION);
    expect(await codeOf(insert(a, m, { reason: "" }))).toBe(CHECK_VIOLATION);
    expect(await codeOf(insert(a, m, { referral_side: "referrer" }))).toBe(CHECK_VIOLATION);
    expect(await codeOf(insert(a, m, { source_member_id: source }))).toBe(CHECK_VIOLATION);
  });

  it("requires a side and a source member for a referral discount", async () => {
    const a = await gym();
    const m = await member(a);
    const source = await member(a);
    const referral = { kind: "referral", reason: null };
    await insert(a, m, { ...referral, referral_side: "referred", source_member_id: source });
    expect(await codeOf(insert(a, m, { ...referral, source_member_id: source }))).toBe(
      CHECK_VIOLATION,
    );
    expect(await codeOf(insert(a, m, { ...referral, referral_side: "referrer" }))).toBe(
      CHECK_VIOLATION,
    );
    expect(
      await codeOf(
        insert(a, m, { ...referral, referral_side: "sponsor", source_member_id: source }),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it("pays one referral out once, while manual discounts can repeat", async () => {
    const a = await gym();
    const m = await member(a);
    const source = await member(a);
    const referral = {
      kind: "referral",
      reason: null,
      referral_side: "referrer",
      source_member_id: source,
    };
    await insert(a, m, referral);
    expect(await codeOf(insert(a, m, referral))).toBe(UNIQUE_VIOLATION);
    await insert(a, source, { ...referral, referral_side: "referred", source_member_id: m });
    await insert(a, m, {});
    await insert(a, m, {});
  });

  it("checks the amount, the dates, and that only a one time discount is consumed", async () => {
    const a = await gym();
    const m = await member(a);
    expect(await codeOf(insert(a, m, { amount: 0 }))).toBe(CHECK_VIOLATION);
    expect(await codeOf(insert(a, m, { starts_on: "2026-11-15", ends_on: "2026-11-14" }))).toBe(
      CHECK_VIOLATION,
    );
    const inv = await invoice(a, m);
    expect(await codeOf(insert(a, m, { is_recurring: true, consumed_invoice_id: inv }))).toBe(
      CHECK_VIOLATION,
    );
    await insert(a, m, { is_recurring: false, consumed_invoice_id: inv });
    await insert(a, m, { is_recurring: true, ends_on: "2026-11-15" });
  });

  it("refuses a member or invoice of another gym", async () => {
    const a = await gym();
    const b = await gym();
    expect(await codeOf(insert(a, await member(b), {}))).toBe(FK_VIOLATION);
    const foreignInvoice = await invoice(b, await member(b));
    expect(await codeOf(insert(a, await member(a), { consumed_invoice_id: foreignInvoice }))).toBe(
      FK_VIOLATION,
    );
  });
});

describe("attendance", () => {
  const insert = (g: Gym, memberId: string, status: string, source: string) =>
    admin.query(
      `INSERT INTO attendance (tenant_id, member_id, scanned_at, local_date, is_duplicate, status_at_scan, source)
       VALUES ($1, $2, '2026-11-15T14:00:00Z', '2026-11-15', false, $3, $4)`,
      [g.tenantId, memberId, status, source],
    );

  it("checks the status snapshot and the source, and defaults meta to empty", async () => {
    const a = await gym();
    const m = await member(a);
    for (const status of ["paid", "due_soon", "overdue", "inactive"]) {
      await insert(a, m, status, "staff_app");
    }
    await insert(a, m, "paid", "manual");
    expect(await codeOf(insert(a, m, "unknown", "staff_app"))).toBe(CHECK_VIOLATION);
    expect(await codeOf(insert(a, m, "paid", "kiosk"))).toBe(CHECK_VIOLATION);
    const { rows } = await admin.query("SELECT meta FROM attendance WHERE member_id = $1 LIMIT 1", [
      m,
    ]);
    expect(rows[0]).toEqual({ meta: {} });
  });

  it("refuses a member of another gym, and is never updated or deleted by the app role", async () => {
    const a = await gym();
    const b = await gym();
    expect(await codeOf(insert(a, await member(b), "paid", "manual"))).toBe(FK_VIOLATION);
    for (const sql of ["UPDATE attendance SET is_duplicate = true", "DELETE FROM attendance"]) {
      expect(await codeOf(app.query(sql)), sql).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });
});

describe("every business table", () => {
  it("has tenant_id as a not null uuid and is protected by row level security", async () => {
    const { rows } = await admin.query(
      `SELECT c.table_name, c.data_type, c.is_nullable
       FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND c.table_name = ANY($1)
       ORDER BY c.table_name`,
      [BUSINESS_TABLES],
    );
    expect(rows).toEqual(
      BUSINESS_TABLES.map((table_name) => ({ table_name, data_type: "uuid", is_nullable: "NO" })),
    );
    expect(await findUnprotectedTenantTables(admin)).toEqual([]);
  });

  it("leads every unique index with tenant_id except the two on members", async () => {
    const { rows } = await admin.query(
      `SELECT tablename, indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = ANY($1) AND indexdef LIKE '%UNIQUE%'`,
      [BUSINESS_TABLES],
    );
    const unled = (rows as { indexname: string; indexdef: string }[])
      .filter((row) => !/\(tenant_id[,)]/.test(row.indexdef))
      .map((row) => row.indexname)
      .filter((name) => !name.endsWith("_pkey"))
      .sort();
    expect(unled).toEqual(["members_barcode_key", "members_member_no_key"]);
  });
});

describe("tenant isolation", () => {
  /** Runs queries as the app role with one tenant set, in a transaction, like withTenantTx does. */
  async function asTenant<T>(tenantId: string | null, body: (client: pg.Client) => Promise<T>) {
    await app.query("BEGIN");
    try {
      if (tenantId !== null) {
        await app.query("SELECT set_config($1, $2, true)", [TENANT_SETTING, tenantId]);
      }
      return await body(app);
    } finally {
      await app.query("ROLLBACK");
    }
  }

  let a: Gym;
  let b: Gym;
  let memberA: string;
  let memberB: string;
  let invoiceB: string;

  beforeAll(async () => {
    a = await gym();
    b = await gym();
    memberA = await member(a);
    memberB = await member(b);
    await period(a, memberA, "2026-01-01", null);
    await period(b, memberB, "2026-01-01", null);
    invoiceB = await invoice(b, memberB);
    await admin.query(
      "INSERT INTO invoice_lines (tenant_id, invoice_id, line_type, description, amount) VALUES ($1, $2, 'membership', 'Monthly fee', 5000)",
      [b.tenantId, invoiceB],
    );
    const payB = await payment(b, memberB);
    await allocate(b, payB, invoiceB, 5000);
    await admin.query(
      "INSERT INTO member_discounts (tenant_id, member_id, kind, amount, is_recurring, reason, starts_on) VALUES ($1, $2, 'manual', 1, true, 'x', '2026-01-01')",
      [b.tenantId, memberB],
    );
    await admin.query(
      "INSERT INTO attendance (tenant_id, member_id, scanned_at, local_date, is_duplicate, status_at_scan, source) VALUES ($1, $2, now(), '2026-11-15', false, 'paid', 'manual')",
      [b.tenantId, memberB],
    );
  });

  it("shows no row of any business table when no tenant is set", async () => {
    for (const table of BUSINESS_TABLES) {
      const { rows } = await asTenant(null, (client) => client.query(`SELECT * FROM ${table}`));
      expect(rows, table).toEqual([]);
    }
  });

  it("lets gym A read none of gym B's rows, by scan or by guessing an id", async () => {
    for (const table of BUSINESS_TABLES) {
      const { rows } = await asTenant(a.tenantId, (client) =>
        client.query(`SELECT tenant_id FROM ${table} WHERE tenant_id = $1`, [b.tenantId]),
      );
      expect(rows, table).toEqual([]);
    }
    const byId = await asTenant(a.tenantId, (client) =>
      client.query("SELECT id FROM invoices WHERE id = $1", [invoiceB]),
    );
    expect(byId.rows).toEqual([]);
    const byBarcode = await asTenant(a.tenantId, (client) =>
      client.query("SELECT id FROM members WHERE id = $1", [memberB]),
    );
    expect(byBarcode.rows).toEqual([]);
  });

  it("lets a gym read its own rows", async () => {
    const { rows } = await asTenant(b.tenantId, (client) => client.query("SELECT id FROM members"));
    expect(rows).toEqual([{ id: memberB }]);
  });

  it("lets gym A neither update nor void gym B's rows", async () => {
    await asTenant(a.tenantId, async (client) => {
      const updated = await client.query(
        "UPDATE plans SET name = 'hijacked' WHERE tenant_id = $1",
        [b.tenantId],
      );
      const voided = await client.query(
        "UPDATE invoices SET is_void = true, void_reason = 'x', voided_at = now() WHERE id = $1",
        [invoiceB],
      );
      expect([updated.rowCount, voided.rowCount]).toEqual([0, 0]);
    });
  });

  it("refuses gym A writing a row for gym B", async () => {
    const attempt = asTenant(a.tenantId, (client) =>
      client.query(
        "INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee) VALUES ($1, 'k', 'n', 0, 0)",
        [b.tenantId],
      ),
    );
    expect(await codeOf(attempt)).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("lets the app role write its own gym's rows through the guards", async () => {
    await asTenant(a.tenantId, async (client) => {
      const inv = await one(
        client,
        `INSERT INTO invoices (tenant_id, member_id, period_start, period_end, due_date, total)
         VALUES ($1, $2, '2027-01-01', '2027-01-31', '2027-01-01', 1000) RETURNING id`,
        [a.tenantId, memberA],
      );
      const pay = await one(
        client,
        `INSERT INTO payments (tenant_id, member_id, amount, method, paid_on, recorded_by, client_request_id)
         VALUES ($1, $2, 1000, 'card', '2027-01-01', $3, $4) RETURNING id`,
        [a.tenantId, memberA, a.userId, randomUUID()],
      );
      await client.query(
        "INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, amount) VALUES ($1, $2, $3, 1000)",
        [a.tenantId, pay, inv],
      );
      const over = client.query(
        "INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, amount) VALUES ($1, $2, $3, 1)",
        [a.tenantId, pay, inv],
      );
      expect(await codeOf(over)).toBe(CHECK_VIOLATION);
    });
  });
});

describe("the migration", () => {
  it("rolls back cleanly and forward again", async () => {
    const source = makeDataSource(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
    await source.initialize();
    try {
      // Newest first: the attendance recorded by column, the session gym, the account claim policies, then the business tables.
      await source.undoLastMigration({ transaction: "each" });
      await source.undoLastMigration({ transaction: "each" });
      await source.undoLastMigration({ transaction: "each" });
      await source.undoLastMigration({ transaction: "each" });
      const gone = await admin.query(
        "SELECT to_regclass('public.members') AS members, to_regproc('guard_money_row') AS fn",
      );
      expect(gone.rows[0]).toEqual({ members: null, fn: null });
      await source.runMigrations({ transaction: "each" });
      const back = await admin.query(
        "SELECT to_regclass('public.membership_periods') AS t, to_regproc('guard_money_row') AS fn",
      );
      expect(back.rows[0]).toEqual({ t: "membership_periods", fn: "guard_money_row" });
      expect(await findUnprotectedTenantTables(admin)).toEqual([]);
    } finally {
      await source.destroy();
    }
  });
});
