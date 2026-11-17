import { describe, expect, it } from "vitest";
import { encodeAttendanceCursor } from "../domain/attendance-query";
import type { MemberView } from "../domain/member-view";
import { brandingFromJson, DEFAULT_SETTINGS, type Tenant } from "../domain/tenant";
import {
  type MemberSelfCaller,
  makeGetMyAttendance,
  makeGetMyCard,
  makeGetMyProfile,
} from "./member-self-service";
import type { AttendanceRecord, MemberSelfServiceUnit } from "./ports";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const OWN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "44444444-4444-4444-8444-444444444444";
const CLOCK = { now: () => new Date("2026-12-01T03:30:00.000Z") };
const CALLER: MemberSelfCaller = { roles: ["member"], tenantId: TENANT_ID, userId: USER_ID };

const TENANT: Tenant = {
  id: TENANT_ID,
  name: "Iron Works",
  subdomain: "iron",
  timezone: "America/Toronto",
  currency: "CAD",
  branding: brandingFromJson({ primary_color: "#112233" }),
  settings: DEFAULT_SETTINGS,
};

const VIEW: MemberView = {
  id: OWN_ID,
  memberNo: "M-0001",
  barcode: "BC-1",
  name: "Ada",
  email: "ada@example.test",
  phone: null,
  photoRef: null,
  status: "cancelled",
  plan: { id: "p", key: "k", name: "Default", admissionFee: 0, monthlyFee: 100, isActive: true },
  joinedOn: "2026-01-01",
  leftOn: "2026-11-01",
  billingDay: 1,
  referredBy: null,
  paidThrough: null,
  standing: "inactive",
  balanceDue: 0,
  credit: 0,
  visitsThisMonth: 0,
  visitsLastMonth: 0,
  totalPaid: 0,
};

function visit(n: number): AttendanceRecord {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    memberId: OWN_ID,
    memberName: "Ada",
    scannedAt: `2026-11-30T12:0${n}:00.000000Z`,
    localDate: "2026-11-30",
    isDuplicate: false,
    statusAtScan: "paid",
    source: "staff_app",
  };
}

interface World {
  memberId?: string | null;
  view?: MemberView | null;
  tenant?: Tenant | null;
  rows?: AttendanceRecord[];
}

function setup(world: World = {}) {
  const calls = {
    users: [] as string[],
    found: [] as string[],
    history: [] as { memberId: string; limit: number; includeDuplicates: boolean }[],
    counts: [] as string[],
  };
  const unit: MemberSelfServiceUnit = {
    self: {
      memberIdOfUser: async (userId) => {
        calls.users.push(userId);
        return world.memberId === undefined ? OWN_ID : world.memberId;
      },
    },
    members: {
      find: async (id) => {
        calls.found.push(id);
        return world.view === undefined ? VIEW : world.view;
      },
    },
    attendance: {
      history: async (memberId, page, includeDuplicates) => {
        calls.history.push({ memberId, limit: page.limit, includeDuplicates });
        return world.rows ?? [];
      },
      monthVisits: async (memberId) => {
        calls.counts.push(memberId);
        return { thisMonth: 2, lastMonth: 5 };
      },
    },
    tenants: { find: async () => (world.tenant === undefined ? TENANT : world.tenant) },
  };
  const deps = {
    withUnit: <T>(_tenantId: string, fn: (u: MemberSelfServiceUnit) => Promise<T>) => fn(unit),
    clock: CLOCK,
  };
  return { deps, calls };
}

describe("permission", () => {
  it("refuses a caller without the member permission before reading anything", async () => {
    const { deps, calls } = setup();
    const noRole = { ...CALLER, roles: [] };
    for (const result of [
      await makeGetMyCard(deps)(undefined, noRole),
      await makeGetMyProfile(deps)(undefined, noRole),
      await makeGetMyAttendance(deps)({}, noRole),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { kind: "forbidden" } });
    }
    expect(calls.users).toEqual([]);
  });
});

describe("a member reads only their own record", () => {
  it("looks the member up by the session user and ignores any member id in the input", async () => {
    const { deps, calls } = setup();
    const sneaky = { memberId: OTHER_ID, limit: 5 } as never;
    await makeGetMyAttendance(deps)(sneaky, CALLER);
    await makeGetMyCard(deps)({ memberId: OTHER_ID } as never, CALLER);
    await makeGetMyProfile(deps)({ memberId: OTHER_ID } as never, CALLER);
    expect(calls.users).toEqual([USER_ID, USER_ID, USER_ID]);
    expect([...calls.found, ...calls.counts, ...calls.history.map((h) => h.memberId)]).toEqual([
      OWN_ID,
      OWN_ID,
      OWN_ID,
      OWN_ID,
    ]);
  });

  it("answers not found for a user who is not a member", async () => {
    const { deps } = setup({ memberId: null });
    for (const result of [
      await makeGetMyCard(deps)(undefined, CALLER),
      await makeGetMyProfile(deps)(undefined, CALLER),
      await makeGetMyAttendance(deps)({}, CALLER),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { kind: "not_found" } });
    }
  });

  it("answers not found when the member row cannot be read", async () => {
    const { deps } = setup({ view: null });
    expect(await makeGetMyCard(deps)(undefined, CALLER)).toMatchObject({ ok: false });
    expect(await makeGetMyProfile(deps)(undefined, CALLER)).toMatchObject({ ok: false });
  });

  it("fails loudly when the gym row is missing", async () => {
    const { deps } = setup({ tenant: null });
    await expect(makeGetMyCard(deps)(undefined, CALLER)).rejects.toThrow("cannot be read");
  });
});

describe("makeGetMyCard", () => {
  it("returns the card with cancelled kept distinct", async () => {
    const result = await makeGetMyCard(setup().deps)(undefined, CALLER);
    expect(result).toEqual({
      ok: true,
      value: {
        gym: { name: "Iron Works", primaryColor: "#112233" },
        barcode: "BC-1",
        memberNo: "M-0001",
        name: "Ada",
        standing: "inactive",
        membershipStatus: "cancelled",
        paidThrough: null,
      },
    });
  });
});

describe("makeGetMyProfile", () => {
  it("returns the read only profile", async () => {
    const result = await makeGetMyProfile(setup().deps)(undefined, CALLER);
    expect(result).toEqual({
      ok: true,
      value: {
        name: "Ada",
        email: "ada@example.test",
        planName: "Default",
        memberNo: "M-0001",
        joinedOn: "2026-01-01",
      },
    });
  });
});

describe("makeGetMyAttendance", () => {
  it("leaves repeats out, reports the counts and groups the visits by month", async () => {
    const { deps, calls } = setup({ rows: [visit(1), visit(2)] });
    const result = await makeGetMyAttendance(deps)({ limit: 5 }, CALLER);
    expect(calls.history).toEqual([{ memberId: OWN_ID, limit: 6, includeDuplicates: false }]);
    expect(result).toEqual({
      ok: true,
      value: {
        visitsThisMonth: 2,
        visitsLastMonth: 5,
        months: [
          {
            month: "2026-11",
            visits: [
              { id: visit(1).id, day: "2026-11-30", time: "07:01" },
              { id: visit(2).id, day: "2026-11-30", time: "07:02" },
            ],
          },
        ],
        nextCursor: null,
      },
    });
  });

  it("gives a cursor that points at the last row of a full page", async () => {
    const { deps } = setup({ rows: [visit(1), visit(2), visit(3)] });
    const result = await makeGetMyAttendance(deps)({ limit: 2 }, CALLER);
    expect(result.ok && result.value.nextCursor).toBe(
      encodeAttendanceCursor({ scannedAt: visit(2).scannedAt, id: visit(2).id }),
    );
    expect(result.ok && result.value.months[0]?.visits).toHaveLength(2);
  });

  it("rejects a bad cursor", async () => {
    const result = await makeGetMyAttendance(setup().deps)({ cursor: "nope" }, CALLER);
    expect(result).toMatchObject({ ok: false, error: { kind: "validation" } });
  });
});
