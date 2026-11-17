import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type BackfillReport, makeBackfill } from "../../app/backfill";
import type { BackfillUnit, WithTenantTx } from "../../app/ports";
import type { BackfillMemberInput } from "../../domain/backfill";
import { clockOnLocalDate } from "../clock";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { makeWithTenantTx, type TenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { stableId } from "../ids";
import { randomCodes } from "../members/member-codes";
import { makeWithBackfillUnit } from "./backfill-unit";
import { dryRunOf } from "./dry-run";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
/** Morning of 16 November in Toronto. */
const NOW = new Date("2026-11-16T15:00:00.000Z");
const CLOCK = { now: () => NOW };

let db: TestDatabase;
let source: DataSource;
let withTenantTx: WithTenantTx<TenantTx>;
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
  withTenantTx = makeWithTenantTx(source);
});

afterAll(async () => {
  await source.destroy();
  await db.drop();
});

async function one(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await db.admin.query(sql, params);
  return (rows[0] as { id: string }).id;
}

async function rows<Row>(sql: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.admin.query(sql, params)).rows as Row[];
}

interface Gym {
  readonly tenantId: string;
  readonly ownerId: string;
}

/** A Toronto gym with an owner, the default plan, and referral defaults that the backfill must never apply. */
async function gym(withPlan = true, withOwner = true): Promise<Gym> {
  counter += 1;
  const tenantId = await one(
    `INSERT INTO tenants (name, subdomain, timezone, currency, settings)
     VALUES ($1, $1, 'America/Toronto', 'CAD', '{"referrer_amount": 1000, "referred_amount": 1000}'::jsonb)
     RETURNING id`,
    [`backfill-gym-${counter}`],
  );
  const ownerId = await one("INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id", [
    tenantId,
    `owner-${counter}@example.test`,
  ]);
  if (withOwner) {
    await db.admin.query(
      "INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, 'owner')",
      [tenantId, ownerId],
    );
  }
  if (withPlan) {
    await db.admin.query(
      "INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee) VALUES ($1, 'default', 'Default', 2000, 5000)",
      [tenantId],
    );
  }
  return { tenantId, ownerId };
}

const lazyTx: WithTenantTx<TenantTx> = (tenantId, fn) => withTenantTx(tenantId, fn);

function backfillOf(options: { dryRun: boolean }, withUnit?: WithTenantTx<BackfillUnit>) {
  const audit = { clock: CLOCK, ids: { next: randomUUID } };
  const run = makeBackfill({
    withUnit: withUnit ?? makeWithBackfillUnit(options.dryRun ? dryRunOf(lazyTx) : lazyTx, audit),
    clock: CLOCK,
    clockOn: clockOnLocalDate,
    codes: randomCodes,
    stableId,
  });
  return (g: Gym, members: readonly BackfillMemberInput[]) =>
    run(members, { tenantId: g.tenantId, requestId: randomUUID() }, options);
}

const real = backfillOf({ dryRun: false });
const dry = backfillOf({ dryRun: true });

function member(
  email: string,
  joinDate: string,
  rest: Partial<BackfillMemberInput> = {},
): BackfillMemberInput {
  return {
    email,
    fullName: email.split("@")[0] ?? email,
    joinDate,
    statusHistory: [],
    payments: [],
    discounts: [],
    ...rest,
  };
}

const FILE: readonly BackfillMemberInput[] = [
  member("ada@example.test", "2026-08-10", {
    payments: [
      { paidOn: "2026-09-10", amount: 5000 },
      { paidOn: "2026-08-10", amount: 7000, method: "card" },
    ],
  }),
  member("bo@example.test", "2026-06-01", {
    statusHistory: [
      { status: "paused", from: "2026-08-01", reason: "travel" },
      { status: "active", from: "2026-10-01", reason: "back" },
    ],
    payments: [
      { paidOn: "2026-06-01", amount: 7000 },
      { paidOn: "2026-07-01", amount: 5000 },
    ],
  }),
  member("cy@example.test", "2026-09-01", {
    statusHistory: [{ status: "cancelled", from: "2026-10-05", reason: "moved away" }],
  }),
  member("di@example.test", "2026-10-01", {
    discounts: [
      {
        kind: "referral",
        referralSide: "referred",
        sourceEmail: "ADA@example.test",
        amount: 1000,
        recurring: true,
        startsOn: "2026-10-01",
      },
      { kind: "manual", reason: "promo", amount: 500, recurring: false, startsOn: "2026-10-01" },
    ],
  }),
  member("ed@example.test", "2026-10-20", { payments: [{ paidOn: "2026-10-20", amount: 20000 }] }),
];

async function fingerprint(tenantId: string): Promise<Record<string, number>> {
  const tables = [
    "users",
    "user_roles",
    "members",
    "membership_periods",
    "invoices",
    "invoice_lines",
    "payments",
    "payment_allocations",
    "member_discounts",
    "audit_events",
  ];
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const [row] = await rows<{ n: string }>(
      `SELECT count(*) AS n FROM ${table} WHERE tenant_id = $1`,
      [tenantId],
    );
    counts[table] = Number(row?.n);
  }
  return counts;
}

function reportOf(result: Awaited<ReturnType<ReturnType<typeof backfillOf>>>): BackfillReport {
  if (!result.ok) throw new Error(`expected a report, got ${result.error.message}`);
  return result.value;
}

async function invoiceTotals(tenantId: string, email: string): Promise<number[]> {
  const found = await rows<{ total: number }>(
    `SELECT i.total FROM invoices i JOIN members m ON m.id = i.member_id JOIN users u ON u.id = m.user_id
      WHERE i.tenant_id = $1 AND u.email = $2 ORDER BY i.period_start`,
    [tenantId, email],
  );
  return found.map((row) => row.total);
}

describe("loading the old records against Postgres", () => {
  it("loads everyone with the live billing code, and applies no referral defaults", async () => {
    const g = await gym();
    const report = reportOf(await real(g, FILE));
    const byEmail = Object.fromEntries(report.members.map((m) => [m.email, m]));

    expect(report.members.map((m) => m.outcome)).toEqual([
      "created",
      "created",
      "created",
      "created",
      "created",
    ]);
    expect(byEmail["ada@example.test"]).toMatchObject({ invoices: 4, payments: 2, discounts: 0 });
    // Paused over August and September: June, July and the August cycle that started on the pause day, then October and November.
    expect(byEmail["bo@example.test"]).toMatchObject({
      invoices: 5,
      statusChanges: 2,
      payments: 2,
    });
    expect(byEmail["cy@example.test"]).toMatchObject({ invoices: 2, statusChanges: 1 });
    expect(byEmail["di@example.test"]).toMatchObject({ invoices: 2, discounts: 2 });

    // 5000 + 2000 admission - 1000 referral - 500 one time, then 5000 - 1000.
    expect(await invoiceTotals(g.tenantId, "di@example.test")).toEqual([5500, 4000]);
    // Only the two discounts of the file exist: the gym's referral defaults never fired.
    expect(await fingerprint(g.tenantId)).toMatchObject({ member_discounts: 2 });
    const periods = await rows<{ status: string; valid_from: string; valid_to: string | null }>(
      `SELECT p.status, p.valid_from::text, p.valid_to::text FROM membership_periods p
         JOIN members m ON m.id = p.member_id JOIN users u ON u.id = m.user_id
        WHERE p.tenant_id = $1 AND u.email = 'bo@example.test' ORDER BY p.valid_from`,
      [g.tenantId],
    );
    expect(periods).toEqual([
      { status: "active", valid_from: "2026-06-01", valid_to: "2026-08-01" },
      { status: "paused", valid_from: "2026-08-01", valid_to: "2026-10-01" },
      { status: "active", valid_from: "2026-10-01", valid_to: null },
    ]);
  });

  it("leaves a cycle that was never paid unpaid and records who recorded each payment", async () => {
    const g = await gym();
    await real(g, [FILE[0] as BackfillMemberInput]);
    const unpaid = await rows<{ period_start: string }>(
      `SELECT i.period_start::text FROM invoices i
        WHERE i.tenant_id = $1
          AND i.total > COALESCE((SELECT sum(a.amount) FROM payment_allocations a WHERE a.invoice_id = i.id), 0)
        ORDER BY i.period_start`,
      [g.tenantId],
    );
    expect(unpaid.map((row) => row.period_start)).toEqual(["2026-10-10", "2026-11-10"]);
    const payments = await rows<{ recorded_by: string; paid_on: string; method: string }>(
      "SELECT recorded_by, paid_on::text, method FROM payments WHERE tenant_id = $1 ORDER BY paid_on",
      [g.tenantId],
    );
    expect(payments).toEqual([
      { recorded_by: g.ownerId, paid_on: "2026-08-10", method: "card" },
      { recorded_by: g.ownerId, paid_on: "2026-09-10", method: "cash" },
    ]);
  });

  it("writes every audit event with no actor", async () => {
    const g = await gym();
    await real(g, FILE);
    const actors = await rows<{ n: string }>(
      "SELECT count(*) AS n FROM audit_events WHERE tenant_id = $1 AND actor_user_id IS NOT NULL",
      [g.tenantId],
    );
    const actions = await rows<{ action: string }>(
      "SELECT DISTINCT action FROM audit_events WHERE tenant_id = $1 ORDER BY action",
      [g.tenantId],
    );
    expect(Number(actors[0]?.n)).toBe(0);
    expect(actions.map((a) => a.action)).toEqual([
      "invoice.generated",
      "member.cancelled",
      "member.created",
      "member.paused",
      "member.resumed",
      "payment.recorded",
    ]);
  });

  it("builds invoices ahead for a payment that is larger than what is owed, and keeps the rest as credit", async () => {
    const g = await gym();
    await real(g, [FILE[4] as BackfillMemberInput]);
    // The October cycle, then November and December built by the 20000 payment, and 3000 of credit.
    expect(await invoiceTotals(g.tenantId, "ed@example.test")).toEqual([7000, 5000, 5000]);
  });

  it("builds more than ten years of invoices in several passes", async () => {
    const g = await gym();
    const [first] = reportOf(await real(g, [member("old@example.test", "1999-01-01")])).members;
    expect(first?.invoices).toBe(27 * 12 + 11);
  });

  it("uses a person who is already in the gym", async () => {
    const g = await gym();
    await db.admin.query(
      "INSERT INTO users (tenant_id, email, name) VALUES ($1, 'fay@example.test', 'Fay')",
      [g.tenantId],
    );
    const report = reportOf(await real(g, [member("fay@example.test", "2026-11-01")]));
    expect(report.members[0]).toMatchObject({ outcome: "created", invoices: 1 });
    expect((await fingerprint(g.tenantId)).users).toBe(2);
  });
});

describe("a dry run and a second run", () => {
  it("a dry run reports what a real run writes, and writes nothing", async () => {
    const g = await gym();
    const before = await fingerprint(g.tenantId);
    const planned = reportOf(await dry(g, FILE));
    expect(await fingerprint(g.tenantId)).toEqual(before);
    const written = reportOf(await real(g, FILE));
    expect(planned).toEqual(written);
  });

  it("a second real run changes nothing", async () => {
    const g = await gym();
    await real(g, FILE);
    const after = await fingerprint(g.tenantId);
    const again = reportOf(await real(g, FILE));
    expect(await fingerprint(g.tenantId)).toEqual(after);
    expect(again.members.map((m) => m.outcome)).toEqual(Array(5).fill("existing"));
    expect(
      again.members.map((m) => [m.statusChanges, m.invoices, m.payments, m.discounts]),
    ).toEqual(Array(5).fill([0, 0, 0, 0]));
    expect(again.members.find((m) => m.email === "ada@example.test")?.paymentsSkipped).toBe(2);
  });

  it("keeps two payments of the same day and amount apart", async () => {
    const g = await gym();
    const twice = member("twin@example.test", "2026-11-01", {
      payments: [
        { paidOn: "2026-11-02", amount: 1000 },
        { paidOn: "2026-11-02", amount: 1000 },
      ],
    });
    expect(reportOf(await real(g, [twice])).members[0]?.payments).toBe(2);
    expect(reportOf(await real(g, [twice])).members[0]).toMatchObject({
      payments: 0,
      paymentsSkipped: 2,
    });
  });
});

describe("what the backfill refuses or reports", () => {
  it("checks the whole file first and writes nothing when any member is wrong", async () => {
    const g = await gym();
    const before = await fingerprint(g.tenantId);
    const result = await real(g, [
      FILE[0] as BackfillMemberInput,
      member("bad@example.test", "2999-01-01"),
    ]);
    expect(result).toMatchObject({ ok: false, error: { kind: "validation" } });
    expect(await fingerprint(g.tenantId)).toEqual(before);
  });

  it("reports a member whose referral source is unknown, leaves nothing of it behind, and loads the rest", async () => {
    const g = await gym();
    const orphan = member("orphan@example.test", "2026-11-01", {
      discounts: [
        {
          kind: "referral",
          referralSide: "referred",
          sourceEmail: "nobody@example.test",
          amount: 500,
          recurring: false,
          startsOn: "2026-11-01",
        },
      ],
    });
    const report = reportOf(await real(g, [orphan, member("ok@example.test", "2026-11-01")]));
    expect(report.members.map((m) => m.outcome)).toEqual(["failed", "created"]);
    expect(report.members[0]?.problem).toBe(
      "The referral source nobody@example.test is not a member yet",
    );
    const emails = await rows<{ email: string }>(
      "SELECT email FROM users WHERE tenant_id = $1 AND email LIKE '%@example.test' AND email NOT LIKE 'owner-%'",
      [g.tenantId],
    );
    expect(emails.map((e) => e.email)).toEqual(["ok@example.test"]);
  });

  it("stops with an error when the gym has no active plan", async () => {
    const g = await gym(false);
    await expect(real(g, [member("a@example.test", "2026-11-01")])).rejects.toThrow(
      "This gym has no active plan yet",
    );
  });

  it("stops with an error when the gym has no owner", async () => {
    const g = await gym(true, false);
    await expect(real(g, [member("a@example.test", "2026-11-01")])).rejects.toThrow(
      "This gym has no owner yet",
    );
  });

  it("stops with an error when the gym cannot be read", async () => {
    const run = backfillOf({ dryRun: false });
    await expect(
      run({ tenantId: randomUUID(), ownerId: randomUUID() }, [
        member("a@example.test", "2026-11-01"),
      ]),
    ).rejects.toThrow("The gym cannot be read");
  });
});
