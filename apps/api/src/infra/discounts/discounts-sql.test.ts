import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeGenerateInvoices } from "../../app/invoices";
import {
  DISCOUNT_ADDED,
  DISCOUNT_ENDED,
  type ManualDiscountContext,
  type ManualDiscountDeps,
  makeAddManualDiscount,
  makeEndDiscount,
} from "../../app/manual-discounts";
import { makeMemberDiscounts } from "../../app/member-ledger";
import type { DiscountUnit, WithTenantTx } from "../../app/ports";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { makeWithTenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { makeWithInvoiceUnit } from "../invoices/invoices-unit";
import { makeWithLedgerUnit } from "../ledger/ledger-unit";
import { makeWithDiscountUnit } from "./discounts-unit";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
/** Morning of 16 November in Toronto. */
const NOW = new Date("2026-11-16T15:00:00.000Z");
const CLOCK = { now: () => NOW };

let db: TestDatabase;
let source: DataSource;
let withDiscount: WithTenantTx<DiscountUnit>;
let generate: ReturnType<typeof makeGenerateInvoices>;
let ledgerDiscounts: ReturnType<typeof makeMemberDiscounts>;
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
  const withTenantTx = makeWithTenantTx(source);
  const audit = { clock: CLOCK, ids: { next: randomUUID } };
  withDiscount = makeWithDiscountUnit(withTenantTx, audit);
  generate = makeGenerateInvoices({
    clock: CLOCK,
    withUnit: makeWithInvoiceUnit(withTenantTx, audit),
  });
  const withLedger = makeWithLedgerUnit(withTenantTx);
  ledgerDiscounts = makeMemberDiscounts({ withUnit: (t, fn) => withLedger(t, fn), clock: CLOCK });
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
  readonly owner: ManualDiscountContext;
  readonly staff: ManualDiscountContext;
  readonly planId: string;
}

async function gym(): Promise<Gym> {
  counter += 1;
  const tenantId = await one(
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $1, 'America/Toronto', 'CAD') RETURNING id",
    [`discount-gym-${counter}`],
  );
  const userId = await one("INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id", [
    tenantId,
    `owner-${counter}@example.test`,
  ]);
  const planId = await one(
    "INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee) VALUES ($1, 'default', 'Default', 2000, 5000) RETURNING id",
    [tenantId],
  );
  const base = { tenantId, userId, requestId: `req-${counter}` };
  return { owner: { ...base, roles: ["owner"] }, staff: { ...base, roles: ["staff"] }, planId };
}

async function member(g: Gym): Promise<string> {
  counter += 1;
  const userId = await one("INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id", [
    g.owner.tenantId,
    `member-${counter}@example.test`,
  ]);
  const memberId = await one(
    `INSERT INTO members (tenant_id, user_id, member_no, barcode, billing_day)
     VALUES ($1, $2, $3, $4, 15) RETURNING id`,
    [g.owner.tenantId, userId, `D${String(counter).padStart(5, "0")}`, randomUUID()],
  );
  await db.admin.query(
    `INSERT INTO membership_periods (tenant_id, member_id, plan_id, status, valid_from)
     VALUES ($1, $2, $3, 'active', '2026-11-15')`,
    [g.owner.tenantId, memberId, g.planId],
  );
  return memberId;
}

const deps: ManualDiscountDeps = { withUnit: (t, fn) => withDiscount(t, fn), clock: CLOCK };
const add = makeAddManualDiscount(deps);
const end = makeEndDiscount(deps);

function value<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** The discount lines of each invoice of a member, oldest cycle first. */
async function discountLines(memberId: string): Promise<[string, number[]][]> {
  const { rows } = await db.admin.query(
    `SELECT to_char(i.period_start, 'YYYY-MM-DD') AS period_start,
            COALESCE(array_agg(l.amount ORDER BY l.id) FILTER (WHERE l.line_type = 'discount'), '{}') AS amounts
       FROM invoices i
       LEFT JOIN invoice_lines l ON l.tenant_id = i.tenant_id AND l.invoice_id = i.id
      WHERE i.member_id = $1
      GROUP BY i.id ORDER BY i.period_start`,
    [memberId],
  );
  return (rows as { period_start: string; amounts: number[] }[]).map((r) => [
    r.period_start,
    r.amounts,
  ]);
}

async function audit(g: Gym, action: string) {
  const { rows } = await db.admin.query(
    `SELECT actor_user_id, entity_type, entity_id, before, after
       FROM audit_events WHERE tenant_id = $1 AND action = $2`,
    [g.owner.tenantId, action],
  );
  return rows;
}

describe("adding a manual discount against Postgres", () => {
  it("stores the row from today, shows it on the Discounts tab, and writes one audit event", async () => {
    const g = await gym();
    const memberId = await member(g);
    const added = value(
      await add({ memberId, amount: 700, isRecurring: false, reason: "Student" }, g.owner),
    );
    expect(added).toMatchObject({
      memberId,
      amount: 700,
      isRecurring: false,
      startsOn: "2026-11-16",
    });

    const { rows } = await db.admin.query(
      "SELECT kind, amount, is_recurring, reason, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, ends_on, created_by FROM member_discounts WHERE id = $1",
      [added.id],
    );
    expect(rows).toEqual([
      {
        kind: "manual",
        amount: 700,
        is_recurring: false,
        reason: "Student",
        starts_on: "2026-11-16",
        ends_on: null,
        created_by: g.owner.userId,
      },
    ]);
    expect(await audit(g, DISCOUNT_ADDED)).toEqual([
      {
        actor_user_id: g.owner.userId,
        entity_type: "member_discount",
        entity_id: added.id,
        before: null,
        after: expect.objectContaining({
          memberId,
          amount: 700,
          reason: "Student",
          startsOn: "2026-11-16",
        }),
      },
    ]);

    const tab = value(
      await ledgerDiscounts(
        { memberId },
        { roles: ["owner"], tenantId: g.owner.tenantId, userId: g.owner.userId },
      ),
    );
    expect(tab.items).toEqual([
      expect.objectContaining({
        id: added.id,
        kind: "manual",
        reason: "Student",
        status: "active",
      }),
    ]);
  });

  it("is for owners only and writes nothing for staff", async () => {
    const g = await gym();
    const memberId = await member(g);
    const result = await add(
      { memberId, amount: 700, isRecurring: true, reason: "Student" },
      g.staff,
    );
    expect(result).toMatchObject({ ok: false, error: { kind: "forbidden" } });
    const { rows } = await db.admin.query(
      "SELECT count(*)::int AS n FROM member_discounts WHERE tenant_id = $1",
      [g.owner.tenantId],
    );
    expect(rows).toEqual([{ n: 0 }]);
  });

  it("refuses a missing reason and a bad amount, and the database would refuse them too", async () => {
    const g = await gym();
    const memberId = await member(g);
    expect(
      await add({ memberId, amount: 700, isRecurring: true, reason: " " }, g.owner),
    ).toMatchObject({
      ok: false,
      error: { kind: "validation" },
    });
    expect(
      await add({ memberId, amount: 0, isRecurring: true, reason: "x" }, g.owner),
    ).toMatchObject({
      ok: false,
      error: { kind: "validation" },
    });
  });

  it("says not found for a member of another gym and writes nothing", async () => {
    const a = await gym();
    const b = await gym();
    const memberId = await member(a);
    const result = await add({ memberId, amount: 500, isRecurring: true, reason: "x" }, b.owner);
    expect(result).toMatchObject({ ok: false, error: { kind: "not_found" } });
    const { rows } = await db.admin.query(
      "SELECT count(*)::int AS n FROM member_discounts WHERE member_id = $1",
      [memberId],
    );
    expect(rows).toEqual([{ n: 0 }]);
    expect(await audit(b, DISCOUNT_ADDED)).toEqual([]);
  });
});

describe("ending a discount against Postgres", () => {
  it("sets an end date, keeps the row, and writes one audit event with the old and new date", async () => {
    const g = await gym();
    const memberId = await member(g);
    const added = value(
      await add({ memberId, amount: 500, isRecurring: true, reason: "Loyal" }, g.owner),
    );
    const ended = value(await end({ discountId: added.id }, g.owner));
    expect(ended).toEqual({ id: added.id, memberId, endsOn: "2026-11-16" });

    const { rows } = await db.admin.query(
      "SELECT to_char(ends_on, 'YYYY-MM-DD') AS ends_on, is_active, amount, reason FROM member_discounts WHERE id = $1",
      [added.id],
    );
    expect(rows).toEqual([
      { ends_on: "2026-11-16", is_active: true, amount: 500, reason: "Loyal" },
    ]);
    expect(await audit(g, DISCOUNT_ENDED)).toEqual([
      expect.objectContaining({
        actor_user_id: g.owner.userId,
        entity_id: added.id,
        before: { endsOn: null },
        after: expect.objectContaining({ endsOn: "2026-11-16", memberId }),
      }),
    ]);
  });

  it("cannot be ended twice, even by two requests at once", async () => {
    const g = await gym();
    const memberId = await member(g);
    const added = value(
      await add({ memberId, amount: 500, isRecurring: true, reason: "Loyal" }, g.owner),
    );
    const results = await Promise.all([
      end({ discountId: added.id }, g.owner),
      end({ discountId: added.id }, g.owner),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    for (const failed of results.filter((r) => !r.ok)) {
      expect(failed).toMatchObject({ error: { kind: "conflict" } });
    }
    expect(await audit(g, DISCOUNT_ENDED)).toHaveLength(1);
  });

  it("brings an end date that was set for later forward to today", async () => {
    const g = await gym();
    const memberId = await member(g);
    const added = value(
      await add({ memberId, amount: 500, isRecurring: true, reason: "Promo" }, g.owner),
    );
    await db.admin.query("UPDATE member_discounts SET ends_on = '2026-12-31' WHERE id = $1", [
      added.id,
    ]);
    expect(value(await end({ discountId: added.id }, g.owner)).endsOn).toBe("2026-11-16");
    expect(await audit(g, DISCOUNT_ENDED)).toEqual([
      expect.objectContaining({ before: { endsOn: "2026-12-31" } }),
    ]);
  });

  it("refuses a one time discount, a not yet started one, and an unknown id", async () => {
    const g = await gym();
    const memberId = await member(g);
    const once = value(
      await add({ memberId, amount: 500, isRecurring: false, reason: "Once" }, g.owner),
    );
    expect(await end({ discountId: once.id }, g.owner)).toMatchObject({
      ok: false,
      error: { kind: "conflict" },
    });
    const later = value(
      await add({ memberId, amount: 500, isRecurring: true, reason: "Later" }, g.owner),
    );
    await db.admin.query("UPDATE member_discounts SET starts_on = '2026-12-01' WHERE id = $1", [
      later.id,
    ]);
    expect(await end({ discountId: later.id }, g.owner)).toMatchObject({
      ok: false,
      error: { kind: "conflict" },
    });
    expect(await end({ discountId: randomUUID() }, g.owner)).toMatchObject({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(await audit(g, DISCOUNT_ENDED)).toEqual([]);
  });

  it("is for owners only", async () => {
    const g = await gym();
    const memberId = await member(g);
    const added = value(
      await add({ memberId, amount: 500, isRecurring: true, reason: "Loyal" }, g.owner),
    );
    expect(await end({ discountId: added.id }, g.staff)).toMatchObject({
      ok: false,
      error: { kind: "forbidden" },
    });
  });

  it("cannot end another gym's discount", async () => {
    const a = await gym();
    const b = await gym();
    const memberId = await member(a);
    const added = value(
      await add({ memberId, amount: 500, isRecurring: true, reason: "Loyal" }, a.owner),
    );
    expect(await end({ discountId: added.id }, b.owner)).toMatchObject({
      ok: false,
      error: { kind: "not_found" },
    });
    const { rows } = await db.admin.query("SELECT ends_on FROM member_discounts WHERE id = $1", [
      added.id,
    ]);
    expect(rows).toEqual([{ ends_on: null }]);
  });
});

describe("what a new or ended discount reaches", () => {
  it("only reaches invoices generated after it, and an ended discount stops reaching later ones", async () => {
    const g = await gym();
    const memberId = await member(g);
    const ctx = { tenantId: g.owner.tenantId, actorUserId: g.owner.userId, requestId: "gen-1" };

    // Two cycles exist before any discount does: 15 November and 15 December.
    value(await generate({ memberId, ahead: 1 }, ctx));
    expect(await discountLines(memberId)).toEqual([
      ["2026-11-15", []],
      ["2026-12-15", []],
    ]);

    const added = value(
      await add({ memberId, amount: 500, isRecurring: true, reason: "Loyal" }, g.owner),
    );
    value(await generate({ memberId, ahead: 2 }, ctx));
    // The two earlier invoices are untouched, the new 15 January one carries the discount.
    expect(await discountLines(memberId)).toEqual([
      ["2026-11-15", []],
      ["2026-12-15", []],
      ["2027-01-15", [-500]],
    ]);

    value(await end({ discountId: added.id }, g.owner));
    value(await generate({ memberId, ahead: 3 }, ctx));
    // January keeps its discount, and the 15 February invoice has none.
    expect(await discountLines(memberId)).toEqual([
      ["2026-11-15", []],
      ["2026-12-15", []],
      ["2027-01-15", [-500]],
      ["2027-02-15", []],
    ]);
  });
});
