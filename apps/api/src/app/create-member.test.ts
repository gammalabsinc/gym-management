import { describe, expect, it } from "vitest";
import type { Plan } from "../domain/plans";
import { brandingFromJson, DEFAULT_SETTINGS, type Tenant } from "../domain/tenant";
import {
  ALREADY_A_MEMBER_MESSAGE,
  type CreateMemberContext,
  MEMBER_CREATED,
  makeCreateMember,
} from "./create-member";
import type {
  AuditEvent,
  BillableMember,
  MemberUnit,
  NewMemberRow,
  NewMembershipPeriod,
  NewReferralRow,
  StaffRecord,
} from "./ports";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const NEW_USER_ID = "44444444-4444-4444-8444-444444444444";
const MEMBER_ID = "55555555-5555-4555-8555-555555555555";
const REFERRER_ID = "66666666-6666-4666-8666-666666666666";
const NOW = new Date("2026-11-16T15:00:00.000Z");

const CTX: CreateMemberContext = {
  roles: ["staff"],
  tenantId: TENANT_ID,
  userId: ACTOR_ID,
  requestId: "req-1",
};

const TENANT: Tenant = {
  id: TENANT_ID,
  name: "Gym",
  subdomain: "gym",
  timezone: "America/Toronto",
  currency: "CAD",
  branding: brandingFromJson({}),
  settings: DEFAULT_SETTINGS,
};

const PLAN: Plan = {
  id: "plan-1",
  key: "default",
  name: "Default",
  admissionFee: 2000,
  monthlyFee: 5000,
  isActive: true,
};

const INPUT = { fullName: "Ada Lovelace", email: "Ada@Example.com", joinDate: "2026-11-16" };

interface Options {
  tenant?: Tenant | null;
  plan?: Plan | null;
  existingUser?: StaffRecord | null;
  /** The member id each user already has. */
  memberOfUser?: Record<string, string>;
  referrerExists?: boolean;
  /** Who the member row says referred them. Left out, it is the referrer the input names. */
  capturedReferrer?: string | null | undefined;
  /** True when the referral already has discount rows. */
  referralExists?: boolean;
  createUserResult?: string | null;
  /** Each insert attempt answers from this list; a null is a refused insert. */
  inserts?: (string | null)[];
  billable?: BillableMember | null;
  now?: Date;
}

function setup(options: Options = {}) {
  const writes: string[] = [];
  const audits: AuditEvent[] = [];
  const created: unknown[] = [];
  const attempts: NewMemberRow[] = [];
  const periods: NewMembershipPeriod[] = [];
  const discounts: NewReferralRow[] = [];
  const inserts = [...(options.inserts ?? [MEMBER_ID])];
  let code = 0;
  const unit: MemberUnit = {
    members: {
      findIdByUser: async (userId) => options.memberOfUser?.[userId] ?? null,
      exists: async () => options.referrerExists ?? true,
      insertIfAbsent: async (row) => {
        attempts.push(row);
        return inserts.shift() ?? null;
      },
      openPeriod: async (period) => {
        periods.push(period);
      },
    },
    staff: {
      findByEmail: async () => options.existingUser ?? null,
      createUser: async (user) => {
        created.push(user);
        return options.createUserResult === undefined ? NEW_USER_ID : options.createUserResult;
      },
      addRole: async (userId, role) => {
        writes.push(`role:${userId}:${role}`);
        return true;
      },
    },
    plans: { findByKey: async () => (options.plan === undefined ? PLAN : options.plan) },
    referrals: {
      referrerOf: async () =>
        options.capturedReferrer === undefined ? REFERRER_ID : options.capturedReferrer,
      exists: async () => options.referralExists ?? false,
      insert: async (row) => {
        discounts.push(row);
        return `discount-${discounts.length}`;
      },
    },
    invoices: {
      lockMember: async () =>
        options.billable === undefined
          ? {
              id: MEMBER_ID,
              billingDay: 16,
              status: "active",
              planId: PLAN.id,
              activeFrom: "2026-11-16",
            }
          : options.billable,
      findPlanFees: async () => ({ admissionFee: 2000, monthlyFee: 5000 }),
      lastPeriodEnd: async () => null,
      discountsOf: async () => [],
      insert: async () => "invoice-1",
      markConsumed: async () => {},
    },
    tenants: { find: async () => (options.tenant === undefined ? TENANT : options.tenant) },
    audit: {
      record: async (event) => {
        audits.push(event);
      },
    },
  };
  const create = makeCreateMember({
    withUnit: async (_tenantId, fn) => fn(unit),
    clock: { now: () => options.now ?? NOW },
    codes: {
      next: () => {
        code += 1;
        return `CODE${String(code).padStart(2, "0")}`;
      },
    },
  });
  return { create, writes, audits, created, attempts, periods, discounts };
}

describe("creating a member", () => {
  it("adds a new person, the member, the first period and the first invoice, with one audit event each", async () => {
    const { create, writes, audits, created, attempts, periods } = setup();
    const result = await create(INPUT, CTX);
    expect(result).toEqual({
      ok: true,
      value: {
        memberId: MEMBER_ID,
        userId: NEW_USER_ID,
        memberNo: "CODE01",
        barcode: "CODE02",
        invoices: [
          expect.objectContaining({ id: "invoice-1", periodStart: "2026-11-16", total: 7000 }),
        ],
      },
    });
    expect(created).toEqual([{ email: "ada@example.com", name: "Ada Lovelace", phone: null }]);
    expect(writes).toEqual([`role:${NEW_USER_ID}:member`]);
    expect(attempts).toEqual([
      {
        userId: NEW_USER_ID,
        memberNo: "CODE01",
        barcode: "CODE02",
        billingDay: 16,
        referredBy: null,
      },
    ]);
    expect(periods).toEqual([
      { memberId: MEMBER_ID, planId: "plan-1", validFrom: "2026-11-16", changedBy: ACTOR_ID },
    ]);
    expect(audits.map((event) => event.action)).toEqual(["invoice.generated", MEMBER_CREATED]);
    expect(audits[1]).toMatchObject({
      actorUserId: ACTOR_ID,
      entityType: "member",
      entityId: MEMBER_ID,
      requestId: "req-1",
      before: null,
      after: { userId: NEW_USER_ID, memberNo: "CODE01", joinDate: "2026-11-16", billingDay: 16 },
    });
    expect(JSON.stringify(audits[1])).not.toContain("CODE02");
    expect(JSON.stringify(audits[1])).not.toContain("example.com");
  });

  it("keeps the person who is already in the gym and only gives them the member role", async () => {
    const existing: StaffRecord = {
      userId: ACTOR_ID,
      name: "Owner",
      email: "ada@example.com",
      roles: ["owner"],
      authSubject: "sub",
    };
    const { create, created, writes, attempts } = setup({ existingUser: existing });
    const result = await create({ ...INPUT, phone: "416-555-0100" }, CTX);
    expect(result).toMatchObject({ ok: true, value: { userId: ACTOR_ID } });
    expect(created).toEqual([]);
    expect(writes).toEqual([`role:${ACTOR_ID}:member`]);
    expect(attempts[0]?.userId).toBe(ACTOR_ID);
  });

  it("passes the phone and the referrer on", async () => {
    const { create, created, attempts } = setup();
    await create({ ...INPUT, phone: "416-555-0100", referredBy: REFERRER_ID }, CTX);
    expect(created).toEqual([
      { email: "ada@example.com", name: "Ada Lovelace", phone: "416-555-0100" },
    ]);
    expect(attempts[0]?.referredBy).toBe(REFERRER_ID);
  });

  it("is a conflict the screen can show when the person already has a member row", async () => {
    const existing: StaffRecord = {
      userId: ACTOR_ID,
      name: null,
      email: "ada@example.com",
      roles: ["member"],
      authSubject: null,
    };
    const { create, attempts, audits } = setup({
      existingUser: existing,
      memberOfUser: { [ACTOR_ID]: MEMBER_ID },
    });
    const result = await create(INPUT, CTX);
    expect(result).toEqual({
      ok: false,
      error: { kind: "conflict", message: ALREADY_A_MEMBER_MESSAGE },
    });
    expect(attempts).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("is the same conflict when someone adds the same email at the same moment", async () => {
    const { create } = setup({ createUserResult: null });
    expect(await create(INPUT, CTX)).toMatchObject({ ok: false, error: { kind: "conflict" } });
  });

  it("tries a new pair of codes when the database refuses the first", async () => {
    const { create, attempts } = setup({ inserts: [null, null, MEMBER_ID] });
    const result = await create(INPUT, CTX);
    expect(result).toMatchObject({ ok: true, value: { memberNo: "CODE05", barcode: "CODE06" } });
    expect(attempts.map((row) => row.memberNo)).toEqual(["CODE01", "CODE03", "CODE05"]);
  });

  it("is a conflict when a refused insert was because the person is a member after all", async () => {
    const { create } = setup({
      inserts: [null],
      memberOfUser: { [NEW_USER_ID]: MEMBER_ID },
    });
    expect(await create(INPUT, CTX)).toMatchObject({ ok: false, error: { kind: "conflict" } });
  });

  it("throws, to roll everything back, when no free code turns up in a bounded number of tries", async () => {
    const { create, attempts } = setup({ inserts: [] });
    await expect(create(INPUT, CTX)).rejects.toThrow("No free member code after 5 attempts");
    expect(attempts).toHaveLength(5);
  });

  it("reports an invalid member without writing anything", async () => {
    const { create, created, writes } = setup();
    const result = await create({ ...INPUT, email: "nope", joinDate: "2026-11-17" }, CTX);
    expect(result).toMatchObject({ ok: false, error: { kind: "validation" } });
    expect(created).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("uses the gym's own calendar for the join date", async () => {
    // 03:00 UTC on 17 November is still the evening of 16 November in Toronto.
    const { create } = setup({ now: new Date("2026-11-17T03:00:00.000Z") });
    expect(await create(INPUT, CTX)).toMatchObject({ ok: true });
    expect(await create({ ...INPUT, joinDate: "2026-11-17" }, CTX)).toMatchObject({ ok: false });
  });

  it("is a conflict when the gym has no active plan", async () => {
    for (const plan of [null, { ...PLAN, isActive: false }]) {
      const { create, writes } = setup({ plan });
      expect(await create(INPUT, CTX)).toMatchObject({ ok: false, error: { kind: "conflict" } });
      expect(writes).toEqual([]);
    }
  });

  it("makes the referral discounts from the gym's defaults before the first invoice", async () => {
    const settings = { ...DEFAULT_SETTINGS, referrerAmount: 1000, referredAmount: 500 };
    const { create, discounts, audits } = setup({ tenant: { ...TENANT, settings } });
    const result = await create({ ...INPUT, referredBy: REFERRER_ID }, CTX);
    expect(result.ok).toBe(true);
    expect(discounts).toEqual([
      expect.objectContaining({
        memberId: REFERRER_ID,
        sourceMemberId: MEMBER_ID,
        side: "referrer",
        amount: 1000,
        startsOn: "2026-11-16",
        createdBy: ACTOR_ID,
      }),
      expect.objectContaining({
        memberId: MEMBER_ID,
        sourceMemberId: REFERRER_ID,
        side: "referred",
        amount: 500,
      }),
    ]);
    expect(audits.map((event) => event.action)).toEqual([
      "discount.created",
      "discount.created",
      "invoice.generated",
      "member.created",
    ]);
  });

  it("makes no discount for a member nobody referred, or when the defaults are zero", async () => {
    const settings = { ...DEFAULT_SETTINGS, referrerAmount: 1000, referredAmount: 500 };
    const nobody = setup({ tenant: { ...TENANT, settings } });
    await nobody.create(INPUT, CTX);
    expect(nobody.discounts).toEqual([]);
    const zero = setup();
    await zero.create({ ...INPUT, referredBy: REFERRER_ID }, CTX);
    expect(zero.discounts).toEqual([]);
  });

  it("throws, to roll the member back, when the referral cannot be applied", async () => {
    const { create } = setup({ referralExists: true });
    await expect(create({ ...INPUT, referredBy: REFERRER_ID }, CTX)).rejects.toThrow(
      "Referral failed: This referral was already applied",
    );
  });

  it("is a validation error when the referrer is not a member of this gym", async () => {
    const { create, created } = setup({ referrerExists: false });
    const result = await create({ ...INPUT, referredBy: REFERRER_ID }, CTX);
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "validation", issues: [{ path: ["referredBy"] }] },
    });
    expect(created).toEqual([]);
  });

  it("throws when the gym row cannot be read", async () => {
    const { create } = setup({ tenant: null });
    await expect(create(INPUT, CTX)).rejects.toThrow("cannot be read");
  });

  it("throws, to roll the member back, when the first invoice cannot be built", async () => {
    const { create } = setup({ billable: null });
    await expect(create(INPUT, CTX)).rejects.toThrow("First invoice failed");
  });

  it("is forbidden for a caller without the permission, and never reaches the database", async () => {
    const { create, created } = setup();
    const result = await create(INPUT, { ...CTX, roles: ["member"] });
    expect(result).toMatchObject({ ok: false, error: { kind: "forbidden" } });
    expect(created).toEqual([]);
  });
});
