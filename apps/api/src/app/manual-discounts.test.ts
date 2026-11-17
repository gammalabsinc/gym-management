import { describe, expect, it } from "vitest";
import { brandingFromJson, DEFAULT_SETTINGS, type Tenant } from "../domain/tenant";
import {
  DISCOUNT_ADDED,
  DISCOUNT_ENDED,
  type ManualDiscountContext,
  makeAddManualDiscount,
  makeEndDiscount,
} from "./manual-discounts";
import type { AuditEvent, DiscountUnit, NewManualDiscountRow, StoredDiscount } from "./ports";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const DISCOUNT_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
/** Half past ten in the evening on 16 November in Toronto, already the 17th in UTC. */
const NOW = new Date("2026-11-17T03:30:00.000Z");
const CLOCK = { now: () => NOW };

const OWNER: ManualDiscountContext = {
  roles: ["owner"],
  tenantId: TENANT_ID,
  userId: USER_ID,
  requestId: "req-1",
};
const STAFF: ManualDiscountContext = { ...OWNER, roles: ["staff"] };
const MEMBER: ManualDiscountContext = { ...OWNER, roles: ["member"] };

const TENANT: Tenant = {
  id: TENANT_ID,
  name: "Gym",
  subdomain: "gym",
  timezone: "America/Toronto",
  currency: "CAD",
  branding: brandingFromJson({}),
  settings: DEFAULT_SETTINGS,
};

const STORED: StoredDiscount = {
  id: DISCOUNT_ID,
  memberId: MEMBER_ID,
  kind: "manual",
  amount: 500,
  isRecurring: true,
  startsOn: "2026-10-01",
  endsOn: null,
  isActive: true,
  consumedInvoiceId: null,
};

interface World {
  memberExists?: boolean;
  discount?: StoredDiscount | null;
  /** What `find` returns on its second call, after the member lock. */
  discountAfterLock?: StoredDiscount | null;
  ended?: boolean;
  tenant?: Tenant | null;
  lockedMember?: boolean;
}

function setup(world: World = {}) {
  const log = {
    inserted: [] as NewManualDiscountRow[],
    ended: [] as { id: string; endsOn: string }[],
    audit: [] as AuditEvent[],
    locked: [] as string[],
    order: [] as string[],
  };
  let finds = 0;
  const unit: DiscountUnit = {
    discounts: {
      find: async () => {
        finds += 1;
        log.order.push("find");
        const first = world.discount === undefined ? STORED : world.discount;
        if (finds === 1) return first;
        return world.discountAfterLock === undefined ? first : world.discountAfterLock;
      },
      insertManual: async (row) => {
        log.order.push("insert");
        log.inserted.push(row);
        return DISCOUNT_ID;
      },
      end: async (id, endsOn) => {
        log.order.push("end");
        log.ended.push({ id, endsOn });
        return world.ended ?? true;
      },
    },
    invoices: {
      lockMember: async (memberId) => {
        log.order.push("lock");
        log.locked.push(memberId);
        return world.memberExists === false
          ? null
          : {
              id: memberId,
              billingDay: 1,
              status: "active",
              planId: DISCOUNT_ID,
              activeFrom: "2026-09-01",
            };
      },
    },
    tenants: { find: async () => (world.tenant === undefined ? TENANT : world.tenant) },
    audit: { record: async (event) => void log.audit.push(event) },
  };
  const deps = {
    withUnit: (_t: string, fn: (u: DiscountUnit) => Promise<never>) => fn(unit),
    clock: CLOCK,
  };
  return { log, deps: deps as unknown as Parameters<typeof makeAddManualDiscount>[0] };
}

const GOOD = { memberId: MEMBER_ID, amount: 500, isRecurring: true, reason: "Loyal member" };

describe("makeAddManualDiscount", () => {
  it("is for owners only", async () => {
    for (const ctx of [STAFF, MEMBER]) {
      const { deps, log } = setup();
      expect(await makeAddManualDiscount(deps)(GOOD, ctx)).toMatchObject({
        ok: false,
        error: { kind: "forbidden" },
      });
      expect(log.inserted).toEqual([]);
    }
  });

  it("refuses bad input before touching the database", async () => {
    const { deps, log } = setup();
    const result = await makeAddManualDiscount(deps)({ ...GOOD, reason: "", amount: 0 }, OWNER);
    expect(result).toMatchObject({ ok: false, error: { kind: "validation" } });
    expect(log.order).toEqual([]);
  });

  it("says not found for a member the gym does not have", async () => {
    const { deps, log } = setup({ memberExists: false });
    expect(await makeAddManualDiscount(deps)(GOOD, OWNER)).toMatchObject({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(log.inserted).toEqual([]);
    expect(log.audit).toEqual([]);
  });

  it("starts the discount today by the gym's calendar, after locking the member, and audits it", async () => {
    const { deps, log } = setup();
    const result = await makeAddManualDiscount(deps)(GOOD, OWNER);
    expect(result).toEqual({
      ok: true,
      value: {
        id: DISCOUNT_ID,
        memberId: MEMBER_ID,
        amount: 500,
        isRecurring: true,
        startsOn: "2026-11-16",
      },
    });
    expect(log.order).toEqual(["lock", "insert"]);
    expect(log.inserted).toEqual([
      {
        memberId: MEMBER_ID,
        amount: 500,
        isRecurring: true,
        reason: "Loyal member",
        startsOn: "2026-11-16",
        createdBy: USER_ID,
      },
    ]);
    expect(log.audit).toEqual([
      {
        actorUserId: USER_ID,
        action: DISCOUNT_ADDED,
        entityType: "member_discount",
        entityId: DISCOUNT_ID,
        before: null,
        after: {
          memberId: MEMBER_ID,
          kind: "manual",
          amount: 500,
          isRecurring: true,
          reason: "Loyal member",
          startsOn: "2026-11-16",
        },
        requestId: "req-1",
      },
    ]);
  });

  it("fails loudly when the gym of the transaction cannot be read", async () => {
    const { deps, log } = setup({ tenant: null });
    await expect(makeAddManualDiscount(deps)(GOOD, OWNER)).rejects.toThrow(/cannot be read/);
    expect(log.inserted).toEqual([]);
  });
});

describe("makeEndDiscount", () => {
  const input = { discountId: DISCOUNT_ID };

  it("is for owners only", async () => {
    for (const ctx of [STAFF, MEMBER]) {
      const { deps, log } = setup();
      expect(await makeEndDiscount(deps)(input, ctx)).toMatchObject({
        ok: false,
        error: { kind: "forbidden" },
      });
      expect(log.ended).toEqual([]);
    }
  });

  it("refuses a bad id", async () => {
    const { deps, log } = setup();
    expect(await makeEndDiscount(deps)({ discountId: "x" }, OWNER)).toMatchObject({
      ok: false,
      error: { kind: "validation" },
    });
    expect(log.order).toEqual([]);
  });

  it("says not found for an unknown discount", async () => {
    const { deps, log } = setup({ discount: null });
    expect(await makeEndDiscount(deps)(input, OWNER)).toMatchObject({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(log.locked).toEqual([]);
  });

  it("sets the end date to today after locking the member and reading the discount again, and audits it", async () => {
    const { deps, log } = setup();
    const result = await makeEndDiscount(deps)(input, OWNER);
    expect(result).toEqual({
      ok: true,
      value: { id: DISCOUNT_ID, memberId: MEMBER_ID, endsOn: "2026-11-16" },
    });
    expect(log.order).toEqual(["find", "lock", "find", "end"]);
    expect(log.ended).toEqual([{ id: DISCOUNT_ID, endsOn: "2026-11-16" }]);
    expect(log.audit).toEqual([
      {
        actorUserId: USER_ID,
        action: DISCOUNT_ENDED,
        entityType: "member_discount",
        entityId: DISCOUNT_ID,
        before: { endsOn: null },
        after: { endsOn: "2026-11-16", memberId: MEMBER_ID, amount: 500 },
        requestId: "req-1",
      },
    ]);
  });

  it("refuses a one time, ended or not yet started discount and writes nothing", async () => {
    const cases = [
      { ...STORED, isRecurring: false },
      { ...STORED, isActive: false },
      { ...STORED, endsOn: "2026-11-01" },
      { ...STORED, startsOn: "2026-11-20" },
    ];
    for (const discount of cases) {
      const { deps, log } = setup({ discount });
      expect(await makeEndDiscount(deps)(input, OWNER)).toMatchObject({
        ok: false,
        error: { kind: "conflict" },
      });
      expect(log.ended).toEqual([]);
      expect(log.audit).toEqual([]);
    }
  });

  it("says conflict, and writes no audit event, when the row had already ended by that day", async () => {
    const { deps, log } = setup({ ended: false, discount: { ...STORED, endsOn: "2026-11-16" } });
    expect(await makeEndDiscount(deps)(input, OWNER)).toMatchObject({
      ok: false,
      error: { kind: "conflict", message: "This discount has already ended" },
    });
    expect(log.audit).toEqual([]);
  });

  it("fails loudly when the member or the discount vanishes under the lock", async () => {
    await expect(
      makeEndDiscount(setup({ memberExists: false }).deps)(input, OWNER),
    ).rejects.toThrow(/member of a discount/);
    await expect(
      makeEndDiscount(setup({ discountAfterLock: null }).deps)(input, OWNER),
    ).rejects.toThrow(/disappeared/);
  });

  it("fails loudly when the gym of the transaction cannot be read", async () => {
    await expect(makeEndDiscount(setup({ tenant: null }).deps)(input, OWNER)).rejects.toThrow(
      /cannot be read/,
    );
  });
});
