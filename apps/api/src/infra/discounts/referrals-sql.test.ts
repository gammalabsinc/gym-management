import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCreateMember } from "../../app/create-member";
import type { MemberUnit, WithTenantTx } from "../../app/ports";
import { ALREADY_REFERRED_MESSAGE, applyReferral } from "../../app/referral";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { makeWithTenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { randomCodes } from "../members/member-codes";
import { makeWithMemberUnit } from "../members/members-unit";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
/** Morning of 16 November in Toronto. */
const NOW = new Date("2026-11-16T15:00:00.000Z");
const CLOCK = { now: () => NOW };

let db: TestDatabase;
let source: DataSource;
let withMember: WithTenantTx<MemberUnit>;
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
  withMember = makeWithMemberUnit(makeWithTenantTx(source), {
    clock: CLOCK,
    ids: { next: randomUUID },
  });
});

afterAll(async () => {
  await source.destroy();
  await db.drop();
});

async function one(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await db.admin.query(sql, params);
  return (rows[0] as { id: string }).id;
}

/** A gym whose referral defaults are 1000 for the referrer every month and 500 once for the new member. */
async function gym(settings: Record<string, unknown> = {}) {
  counter += 1;
  const tenantId = await one(
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $1, 'America/Toronto', 'CAD') RETURNING id",
    [`referral-gym-${counter}`],
  );
  await setSettings(tenantId, {
    referrer_amount: 1000,
    referrer_is_recurring: true,
    referred_amount: 500,
    referred_is_recurring: false,
    ...settings,
  });
  const userId = await one("INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id", [
    tenantId,
    `staff-${counter}@example.test`,
  ]);
  await db.admin.query(
    "INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee) VALUES ($1, 'default', 'Default', 2000, 5000)",
    [tenantId],
  );
  return { ctx: { roles: ["staff"] as const, tenantId, userId, requestId: `req-${counter}` } };
}

type Gym = Awaited<ReturnType<typeof gym>>;

async function setSettings(tenantId: string, settings: Record<string, unknown>): Promise<void> {
  await db.admin.query("UPDATE tenants SET settings = settings || $2::jsonb WHERE id = $1", [
    tenantId,
    JSON.stringify(settings),
  ]);
}

async function add(g: Gym, extra: Record<string, unknown> = {}) {
  counter += 1;
  const created = await makeCreateMember({
    withUnit: withMember,
    clock: CLOCK,
    codes: randomCodes,
  })(
    {
      fullName: "Ada Lovelace",
      email: `ada-${counter}@example.test`,
      joinDate: "2026-11-16",
      ...extra,
    },
    { ...g.ctx, roles: ["staff"] },
  );
  if (!created.ok) throw new Error(`expected a member, got ${created.error.message}`);
  return created.value;
}

interface DiscountRow {
  readonly member_id: string;
  readonly source_member_id: string;
  readonly referral_side: string;
  readonly amount: number;
  readonly is_recurring: boolean;
  readonly starts_on: string;
  readonly created_by: string;
  readonly kind: string;
}

function discountsOf(tenantId: string): Promise<DiscountRow[]> {
  return db.admin
    .query(
      `SELECT member_id, source_member_id, referral_side, amount, is_recurring,
              starts_on::text AS starts_on, created_by, kind
         FROM member_discounts WHERE tenant_id = $1 ORDER BY referral_side DESC`,
      [tenantId],
    )
    .then((result) => result.rows as DiscountRow[]);
}

const apply = (g: Gym, memberId: string, referrerId: string) =>
  withMember(g.ctx.tenantId, async (unit) => {
    const tenant = await unit.tenants.find();
    if (tenant === null) throw new Error("no gym");
    return applyReferral(unit, {
      memberId,
      referrerId,
      startsOn: "2026-11-16",
      settings: tenant.settings,
      actorUserId: g.ctx.userId,
      requestId: "req-apply",
    });
  });

describe("referral defaults on a real database", () => {
  it("makes the discounts when a member is added with a referrer, and the new member's lands on the first invoice", async () => {
    const g = await gym();
    const referrer = await add(g);
    const referred = await add(g, { referredBy: referrer.memberId });

    expect(await discountsOf(g.ctx.tenantId)).toEqual([
      {
        member_id: referrer.memberId,
        source_member_id: referred.memberId,
        referral_side: "referrer",
        amount: 1000,
        is_recurring: true,
        starts_on: "2026-11-16",
        created_by: g.ctx.userId,
        kind: "referral",
      },
      {
        member_id: referred.memberId,
        source_member_id: referrer.memberId,
        referral_side: "referred",
        amount: 500,
        is_recurring: false,
        starts_on: "2026-11-16",
        created_by: g.ctx.userId,
        kind: "referral",
      },
    ]);
    const lines = await db.admin.query(
      "SELECT line_type, amount FROM invoice_lines WHERE invoice_id = $1 ORDER BY amount",
      [referred.invoices[0]?.id],
    );
    expect(lines.rows).toEqual([
      { line_type: "discount", amount: -500 },
      { line_type: "admission", amount: 2000 },
      { line_type: "membership", amount: 5000 },
    ]);
    expect(referred.invoices[0]?.total).toBe(6500);
    const consumed = await db.admin.query(
      "SELECT consumed_invoice_id FROM member_discounts WHERE member_id = $1",
      [referred.memberId],
    );
    expect(consumed.rows).toEqual([{ consumed_invoice_id: referred.invoices[0]?.id }]);
  });

  it("writes one audit event per discount in the same transaction", async () => {
    const g = await gym();
    const referrer = await add(g);
    await add(g, { referredBy: referrer.memberId });
    const events = await db.admin.query(
      "SELECT action, entity_type FROM audit_events WHERE tenant_id = $1 AND action = 'discount.created'",
      [g.ctx.tenantId],
    );
    expect(events.rows).toEqual([
      { action: "discount.created", entity_type: "discount" },
      { action: "discount.created", entity_type: "discount" },
    ]);
  });

  it("makes no row for a side whose default is zero, and none when nobody referred the member", async () => {
    const g = await gym({ referred_amount: 0 });
    const referrer = await add(g);
    expect(await discountsOf(g.ctx.tenantId)).toEqual([]);
    await add(g, { referredBy: referrer.memberId });
    expect((await discountsOf(g.ctx.tenantId)).map((row) => row.referral_side)).toEqual([
      "referrer",
    ]);
    const off = await gym({ referrer_amount: 0, referred_amount: 0 });
    const first = await add(off);
    await add(off, { referredBy: first.memberId });
    expect(await discountsOf(off.ctx.tenantId)).toEqual([]);
  });

  it("does not rewrite existing discounts when the defaults change, and uses the new ones for the next referral", async () => {
    const g = await gym();
    const referrer = await add(g);
    await add(g, { referredBy: referrer.memberId });
    const before = await discountsOf(g.ctx.tenantId);

    await setSettings(g.ctx.tenantId, {
      referrer_amount: 7000,
      referrer_is_recurring: false,
      referred_amount: 0,
    });
    expect(await discountsOf(g.ctx.tenantId)).toEqual(before);

    const next = await add(g, { referredBy: referrer.memberId });
    const added = (await discountsOf(g.ctx.tenantId)).filter(
      (row) => row.source_member_id === next.memberId,
    );
    expect(added).toEqual([
      expect.objectContaining({ referral_side: "referrer", amount: 7000, is_recurring: false }),
    ]);
    expect(await discountsOf(g.ctx.tenantId)).toHaveLength(before.length + 1);
  });

  it("rolls the new member back when the referral cannot be written", async () => {
    const g = await gym();
    const referrer = await add(g);
    const failing = makeCreateMember({
      clock: CLOCK,
      codes: randomCodes,
      withUnit: (tenantId, fn) =>
        withMember(tenantId, (unit) =>
          fn({ ...unit, referrals: { ...unit.referrals, exists: async () => true } }),
        ),
    });
    counter += 1;
    await expect(
      failing(
        {
          fullName: "Bo",
          email: `bo-${counter}@example.test`,
          joinDate: "2026-11-16",
          referredBy: referrer.memberId,
        },
        { ...g.ctx, roles: ["staff"] },
      ),
    ).rejects.toThrow("Referral failed");
    const members = await db.admin.query("SELECT 1 FROM members WHERE tenant_id = $1", [
      g.ctx.tenantId,
    ]);
    expect(members.rows).toHaveLength(1);
    expect(await discountsOf(g.ctx.tenantId)).toEqual([]);
  });

  describe("applying a referral directly", () => {
    it("refuses a self referral and writes nothing", async () => {
      const g = await gym();
      const member = await add(g);
      const result = await apply(g, member.memberId, member.memberId);
      expect(result).toMatchObject({ ok: false, error: { kind: "validation" } });
      expect(await discountsOf(g.ctx.tenantId)).toEqual([]);
    });

    it("refuses a second referral for the same new member, from the same or another referrer", async () => {
      const g = await gym();
      const referrer = await add(g);
      const other = await add(g);
      const referred = await add(g, { referredBy: referrer.memberId });
      const before = await discountsOf(g.ctx.tenantId);

      expect(await apply(g, referred.memberId, referrer.memberId)).toEqual({
        ok: false,
        error: { kind: "conflict", message: ALREADY_REFERRED_MESSAGE },
      });
      expect(await apply(g, referred.memberId, other.memberId)).toMatchObject({
        ok: false,
        error: { kind: "validation", issues: [{ path: ["referredBy"] }] },
      });
      expect(await discountsOf(g.ctx.tenantId)).toEqual(before);
    });

    it("refuses a referral for a member nobody referred, and for a member the gym does not have", async () => {
      const g = await gym();
      const referrer = await add(g);
      const plain = await add(g);
      expect(await apply(g, plain.memberId, referrer.memberId)).toMatchObject({
        ok: false,
        error: { kind: "validation" },
      });
      expect(await apply(g, randomUUID(), referrer.memberId)).toEqual({
        ok: false,
        error: { kind: "not_found", message: "Member not found" },
      });
      expect(await discountsOf(g.ctx.tenantId)).toEqual([]);
    });
  });

  describe("the database as the final judge", () => {
    it("refuses the same referral row twice", async () => {
      const g = await gym();
      const referrer = await add(g);
      const referred = await add(g, { referredBy: referrer.memberId });
      const second = await withMember(g.ctx.tenantId, (unit) =>
        unit.referrals.insert({
          memberId: referred.memberId,
          sourceMemberId: referrer.memberId,
          side: "referred",
          amount: 500,
          isRecurring: false,
          startsOn: "2026-11-16",
          createdBy: g.ctx.userId,
        }),
      );
      expect(second).toBeNull();
      expect(await discountsOf(g.ctx.tenantId)).toHaveLength(2);
    });
  });

  describe("across gyms", () => {
    it("cannot see another gym's members or discounts", async () => {
      const a = await gym();
      const b = await gym();
      const referrer = await add(a);
      const referred = await add(a, { referredBy: referrer.memberId });
      const seen = await withMember(b.ctx.tenantId, async (unit) => ({
        referrerOf: await unit.referrals.referrerOf(referred.memberId),
        exists: await unit.referrals.exists(referred.memberId, referrer.memberId),
      }));
      expect(seen).toEqual({ referrerOf: undefined, exists: false });
      expect(await apply(b, referred.memberId, referrer.memberId)).toMatchObject({
        ok: false,
        error: { kind: "not_found" },
      });
      expect(await discountsOf(b.ctx.tenantId)).toEqual([]);
    });
  });
});
