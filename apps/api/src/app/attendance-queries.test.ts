import { describe, expect, it } from "vitest";
import { encodeAttendanceCursor } from "../domain/attendance-query";
import { brandingFromJson, DEFAULT_SETTINGS, type Tenant } from "../domain/tenant";
import {
  type AttendanceCaller,
  makeDailyVisitCounts,
  makeMemberHistory,
  makeMemberVisitCounts,
  makeTodaysAttendance,
} from "./attendance-queries";
import type {
  AttendancePageRequest,
  AttendanceQueryStore,
  AttendanceQueryUnit,
  AttendanceRecord,
} from "./ports";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
/** Half past ten in the evening on 30 November in Toronto, already 1 December in UTC. */
const NOW = new Date("2026-12-01T03:30:00.000Z");
const CLOCK = { now: () => NOW };
const STAFF: AttendanceCaller = { roles: ["staff"], tenantId: TENANT_ID };
const OWNER: AttendanceCaller = { roles: ["owner"], tenantId: TENANT_ID };
const MEMBER: AttendanceCaller = { roles: ["member"], tenantId: TENANT_ID };

const TENANT: Tenant = {
  id: TENANT_ID,
  name: "Gym",
  subdomain: "gym",
  timezone: "America/Toronto",
  currency: "CAD",
  branding: brandingFromJson({}),
  settings: DEFAULT_SETTINGS,
};

function record(n: number, overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    memberId: MEMBER_ID,
    memberName: "Ada Lovelace",
    scannedAt: `2026-11-30T12:0${n}:00.000000Z`,
    localDate: "2026-11-30",
    isDuplicate: false,
    statusAtScan: "paid",
    source: "staff_app",
    ...overrides,
  };
}

interface World {
  rows?: AttendanceRecord[];
  memberExists?: boolean;
  tenant?: Tenant | null;
  counts?: { thisMonth: number; lastMonth: number };
  days?: { date: string; visits: number }[];
}

function setup(world: World = {}) {
  const calls = {
    history: [] as { memberId: string; page: AttendancePageRequest; includeDuplicates: boolean }[],
    onDay: [] as { localDate: string; page: AttendancePageRequest }[],
    monthVisits: [] as string[][],
    dailyCounts: [] as string[][],
    tenants: [] as string[],
  };
  const attendance: AttendanceQueryStore = {
    memberExists: async () => world.memberExists ?? true,
    history: async (memberId, page, includeDuplicates) => {
      calls.history.push({ memberId, page, includeDuplicates });
      return world.rows ?? [];
    },
    onDay: async (localDate, page) => {
      calls.onDay.push({ localDate, page });
      return world.rows ?? [];
    },
    monthVisits: async (memberId, lastStart, thisStart, nextStart) => {
      calls.monthVisits.push([memberId, lastStart, thisStart, nextStart]);
      return world.counts ?? { thisMonth: 0, lastMonth: 0 };
    },
    dailyCounts: async (from, to) => {
      calls.dailyCounts.push([from, to]);
      return world.days ?? [];
    },
  };
  const unit: AttendanceQueryUnit = {
    attendance,
    tenants: { find: async () => (world.tenant === undefined ? TENANT : world.tenant) },
  };
  const deps = {
    withUnit: <T>(tenantId: string, fn: (u: AttendanceQueryUnit) => Promise<T>) => {
      calls.tenants.push(tenantId);
      return fn(unit);
    },
    clock: CLOCK,
  };
  return { deps, calls };
}

describe("makeMemberHistory", () => {
  it("returns the rows with repeats included and asks for one row more than the page", async () => {
    const { deps, calls } = setup({ rows: [record(1, { isDuplicate: true }), record(2)] });
    const result = await makeMemberHistory(deps)({ memberId: MEMBER_ID, limit: 5 }, STAFF);
    expect(result).toEqual({
      ok: true,
      value: { items: [record(1, { isDuplicate: true }), record(2)], nextCursor: null },
    });
    expect(calls.history).toEqual([
      { memberId: MEMBER_ID, page: { limit: 6, after: null }, includeDuplicates: true },
    ]);
    expect(calls.tenants).toEqual([TENANT_ID]);
  });

  it("gives a next cursor that points at the last row of the page", async () => {
    const { deps } = setup({ rows: [record(1), record(2), record(3)] });
    const result = await makeMemberHistory(deps)({ memberId: MEMBER_ID, limit: 2 }, STAFF);
    expect(result.ok && result.value.items).toHaveLength(2);
    expect(result.ok && result.value.nextCursor).toBe(
      encodeAttendanceCursor({ scannedAt: record(2).scannedAt, id: record(2).id }),
    );
  });

  it("passes the position of the cursor on to the store", async () => {
    const after = { scannedAt: record(2).scannedAt, id: record(2).id };
    const { deps, calls } = setup();
    await makeMemberHistory(deps)(
      { memberId: MEMBER_ID, limit: 2, cursor: encodeAttendanceCursor(after) },
      STAFF,
    );
    expect(calls.history[0]?.page).toEqual({ limit: 3, after });
  });

  it("refuses a bad member id before opening a transaction", async () => {
    const { deps, calls } = setup();
    const result = await makeMemberHistory(deps)({ memberId: "nope" }, STAFF);
    expect(result.ok).toBe(false);
    expect(calls.tenants).toEqual([]);
  });

  it("answers not found for a member of no such gym", async () => {
    const { deps, calls } = setup({ memberExists: false });
    const result = await makeMemberHistory(deps)({ memberId: MEMBER_ID }, STAFF);
    expect(result).toMatchObject({ ok: false, error: { kind: "not_found" } });
    expect(calls.history).toEqual([]);
  });

  it("refuses a caller without member.read", async () => {
    const { deps, calls } = setup();
    const result = await makeMemberHistory(deps)({ memberId: MEMBER_ID }, MEMBER);
    expect(result).toMatchObject({ ok: false, error: { kind: "forbidden" } });
    expect(calls.tenants).toEqual([]);
  });
});

describe("makeMemberVisitCounts", () => {
  it("counts by the gym's calendar months, not the UTC date", async () => {
    const { deps, calls } = setup({ counts: { thisMonth: 3, lastMonth: 9 } });
    const result = await makeMemberVisitCounts(deps)({ memberId: MEMBER_ID }, STAFF);
    expect(result).toEqual({ ok: true, value: { thisMonth: 3, lastMonth: 9 } });
    // It is still 30 November in Toronto, so this month is November and last month is October.
    expect(calls.monthVisits).toEqual([[MEMBER_ID, "2026-10-01", "2026-11-01", "2026-12-01"]]);
  });

  it("refuses a bad member id", async () => {
    const { deps } = setup();
    const result = await makeMemberVisitCounts(deps)({ memberId: "nope" }, STAFF);
    expect(result).toMatchObject({ ok: false, error: { kind: "validation" } });
  });

  it("answers not found for an unknown member", async () => {
    const { deps, calls } = setup({ memberExists: false });
    const result = await makeMemberVisitCounts(deps)({ memberId: MEMBER_ID }, STAFF);
    expect(result).toMatchObject({ ok: false, error: { kind: "not_found" } });
    expect(calls.monthVisits).toEqual([]);
  });

  it("throws when the gym of the transaction cannot be read", async () => {
    const { deps } = setup({ tenant: null });
    await expect(makeMemberVisitCounts(deps)({ memberId: MEMBER_ID }, STAFF)).rejects.toThrow(
      "The gym of this transaction cannot be read",
    );
  });

  it("refuses a caller without member.read", async () => {
    const { deps } = setup();
    const result = await makeMemberVisitCounts(deps)({ memberId: MEMBER_ID }, MEMBER);
    expect(result).toMatchObject({ ok: false, error: { kind: "forbidden" } });
  });
});

describe("makeTodaysAttendance", () => {
  it("reads the gym's local day, which is still 30 November", async () => {
    const { deps, calls } = setup({ rows: [record(1)] });
    const result = await makeTodaysAttendance(deps)({ limit: 10 }, STAFF);
    expect(result).toEqual({ ok: true, value: { items: [record(1)], nextCursor: null } });
    expect(calls.onDay).toEqual([{ localDate: "2026-11-30", page: { limit: 11, after: null } }]);
  });

  it("pages with a cursor", async () => {
    const { deps } = setup({ rows: [record(1), record(2)] });
    const result = await makeTodaysAttendance(deps)({ limit: 1 }, STAFF);
    expect(result.ok && result.value.nextCursor).not.toBeNull();
  });

  it("refuses a bad cursor", async () => {
    const { deps } = setup();
    const result = await makeTodaysAttendance(deps)({ cursor: "%%%" }, STAFF);
    expect(result).toMatchObject({ ok: false, error: { kind: "validation" } });
  });

  it("throws when the gym of the transaction cannot be read", async () => {
    const { deps } = setup({ tenant: null });
    await expect(makeTodaysAttendance(deps)({}, STAFF)).rejects.toThrow(
      "The gym of this transaction cannot be read",
    );
  });

  it("refuses a caller without member.read", async () => {
    const { deps } = setup();
    expect(await makeTodaysAttendance(deps)({}, MEMBER)).toMatchObject({
      ok: false,
      error: { kind: "forbidden" },
    });
  });
});

describe("makeDailyVisitCounts", () => {
  it("lists every day of the range with zeros filled in", async () => {
    const { deps, calls } = setup({ days: [{ date: "2026-11-29", visits: 2 }] });
    const result = await makeDailyVisitCounts(deps)(
      { from: "2026-11-28", to: "2026-11-30" },
      OWNER,
    );
    expect(result).toEqual({
      ok: true,
      value: [
        { date: "2026-11-28", visits: 0 },
        { date: "2026-11-29", visits: 2 },
        { date: "2026-11-30", visits: 0 },
      ],
    });
    expect(calls.dailyCounts).toEqual([["2026-11-28", "2026-11-30"]]);
  });

  it("refuses a bad range", async () => {
    const { deps, calls } = setup();
    const result = await makeDailyVisitCounts(deps)(
      { from: "2026-11-30", to: "2026-11-01" },
      OWNER,
    );
    expect(result).toMatchObject({ ok: false, error: { kind: "validation" } });
    expect(calls.tenants).toEqual([]);
  });

  it("is for owners only", async () => {
    const { deps } = setup();
    const result = await makeDailyVisitCounts(deps)(
      { from: "2026-11-01", to: "2026-11-30" },
      STAFF,
    );
    expect(result).toMatchObject({ ok: false, error: { kind: "forbidden" } });
  });
});
