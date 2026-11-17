import { describe, expect, it } from "vitest";
import type { LoaderUnit, MemberQueryContext } from "../app/ports";
import type { MemberView } from "../domain/member-view";
import type { Plan } from "../domain/plans";
import { brandingFromJson, DEFAULT_SETTINGS, type Tenant } from "../domain/tenant";
import { MAX_BATCH_SIZE, makeRequestLoaders } from "./loaders";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
/** Half past ten in the evening on 30 November in Toronto, already 1 December in UTC. */
const NOW = new Date("2026-12-01T03:30:00.000Z");

const TENANT: Tenant = {
  id: TENANT_ID,
  name: "Gym",
  subdomain: "gym",
  timezone: "America/Toronto",
  currency: "CAD",
  branding: brandingFromJson({}),
  settings: DEFAULT_SETTINGS,
};

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

const PLAN: Plan = {
  id: uuid(900),
  key: "default",
  name: "Default",
  admissionFee: 0,
  monthlyFee: 5000,
  isActive: true,
};

function view(n: number, standing: MemberView["standing"] = "paid"): MemberView {
  return {
    id: uuid(n),
    memberNo: `GYM-${n}`,
    barcode: `B${n}`,
    name: `Member ${n}`,
    email: `m${n}@example.test`,
    phone: null,
    photoRef: null,
    status: "active",
    plan: { ...PLAN },
    joinedOn: "2026-10-01",
    leftOn: null,
    billingDay: 1,
    referredBy: null,
    paidThrough: null,
    standing,
    balanceDue: 0,
    credit: 0,
    visitsThisMonth: 0,
    visitsLastMonth: 0,
    totalPaid: 0,
  };
}

interface World {
  members?: MemberView[];
  plans?: Plan[];
  tenant?: Tenant | null;
  clockReads?: { count: number };
}

function setup(world: World = {}) {
  const memberBatches: string[][] = [];
  const contexts: MemberQueryContext[] = [];
  const planBatches: string[][] = [];
  const tenantIds: string[] = [];
  const unit: LoaderUnit = {
    members: {
      findMany: async (ids, context) => {
        memberBatches.push([...ids]);
        contexts.push(context);
        return (world.members ?? []).filter((m) => ids.includes(m.id));
      },
    },
    plans: {
      findMany: async (ids) => {
        planBatches.push([...ids]);
        return (world.plans ?? []).filter((p) => ids.includes(p.id));
      },
    },
    tenants: { find: async () => (world.tenant === undefined ? TENANT : world.tenant) },
  };
  const deps = {
    withUnit: <T>(tenantId: string, fn: (u: LoaderUnit) => Promise<T>) => {
      tenantIds.push(tenantId);
      return fn(unit);
    },
    clock: {
      now: () => {
        if (world.clockReads) world.clockReads.count += 1;
        return NOW;
      },
    },
  };
  return {
    loaders: makeRequestLoaders(deps, TENANT_ID),
    memberBatches,
    contexts,
    planBatches,
    tenantIds,
  };
}

describe("member loader", () => {
  it("sends every id asked for in one tick as one batch, in the order asked", async () => {
    const { loaders, memberBatches, tenantIds } = setup({ members: [view(1), view(2), view(3)] });
    const loaded = await Promise.all([3, 1, 2].map((n) => loaders.member.load(uuid(n))));
    expect(loaded.map((m) => m?.id)).toEqual([uuid(3), uuid(1), uuid(2)]);
    expect(memberBatches).toEqual([[uuid(3), uuid(1), uuid(2)]]);
    expect(tenantIds).toEqual([TENANT_ID]);
  });

  it("asks once for an id that is requested twice, and caches it for the request", async () => {
    const { loaders, memberBatches } = setup({ members: [view(1)] });
    await Promise.all([loaders.member.load(uuid(1)), loaders.member.load(uuid(1))]);
    await loaders.member.load(uuid(1));
    expect(memberBatches).toEqual([[uuid(1)]]);
  });

  it("answers null for a member the gym does not have", async () => {
    const { loaders } = setup({ members: [view(1)] });
    expect(await loaders.member.load(uuid(2))).toBeNull();
  });

  it("answers null for an id that is not a uuid without sending it to the database", async () => {
    const { loaders, memberBatches } = setup({ members: [view(1)] });
    const loaded = await Promise.all([loaders.member.load("nope"), loaders.member.load(uuid(1))]);
    expect(loaded.map((m) => m?.id ?? null)).toEqual([null, uuid(1)]);
    expect(memberBatches).toEqual([[uuid(1)]]);
  });

  it("derives standing from the gym's local day, read from the clock once per request", async () => {
    const clockReads = { count: 0 };
    const { loaders, contexts } = setup({ members: [view(1), view(2)], clockReads });
    await loaders.member.load(uuid(1));
    loaders.member.clear(uuid(1));
    await loaders.member.load(uuid(2));
    expect(clockReads.count).toBe(1);
    expect(contexts).toHaveLength(2);
    expect(contexts[0]).toMatchObject({ today: "2026-11-30", thisMonthStart: "2026-11-01" });
  });

  it("splits a very large batch so no statement carries more than the maximum", async () => {
    const count = MAX_BATCH_SIZE + 20;
    const members = Array.from({ length: count }, (_, i) => view(i + 1));
    const { loaders, memberBatches } = setup({ members });
    await Promise.all(members.map((m) => loaders.member.load(m.id)));
    expect(memberBatches.map((batch) => batch.length)).toEqual([MAX_BATCH_SIZE, 20]);
  });

  it("fails every waiting load when the gym of the transaction cannot be read", async () => {
    const { loaders } = setup({ tenant: null });
    await expect(loaders.member.load(uuid(1))).rejects.toThrow(
      "The gym of this transaction cannot be read",
    );
  });
});

describe("plan loader", () => {
  it("batches plan ids, answers null for an unknown plan and skips ids that are not uuids", async () => {
    const { loaders, planBatches } = setup({ plans: [PLAN] });
    const loaded = await Promise.all([
      loaders.plan.load(PLAN.id),
      loaders.plan.load(uuid(901)),
      loaders.plan.load("nope"),
    ]);
    expect(loaded).toEqual([PLAN, null, null]);
    expect(planBatches).toEqual([[PLAN.id, uuid(901)]]);
  });
});

describe("standing loader", () => {
  it("rides on the member loader, so it adds no statement of its own", async () => {
    const { loaders, memberBatches } = setup({ members: [view(1, "overdue"), view(2, "paid")] });
    const standings = await Promise.all([
      loaders.standing(uuid(1)),
      loaders.standing(uuid(2)),
      loaders.member.load(uuid(1)),
    ]);
    expect(standings.slice(0, 2)).toEqual(["overdue", "paid"]);
    expect(memberBatches).toHaveLength(1);
  });

  it("answers null for an unknown member", async () => {
    const { loaders } = setup();
    expect(await loaders.standing(uuid(1))).toBeNull();
  });
});
