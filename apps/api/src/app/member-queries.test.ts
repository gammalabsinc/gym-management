import { describe, expect, it } from "vitest";
import type { MemberListRow, MemberView } from "../domain/member-view";
import { brandingFromJson, DEFAULT_SETTINGS, type Tenant } from "../domain/tenant";
import { makeGetMember, makeListMembers } from "./member-queries";
import type { MemberPageRequest, MemberQueryContext, MemberQueryUnit } from "./ports";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const CTX = { roles: ["staff"] as const, tenantId: TENANT_ID };
const CLOCK = { now: () => new Date("2026-11-16T15:00:00.000Z") };

const TENANT: Tenant = {
  id: TENANT_ID,
  name: "Gym",
  subdomain: "gym",
  timezone: "America/Toronto",
  currency: "CAD",
  branding: brandingFromJson({}),
  settings: { ...DEFAULT_SETTINGS, warnDaysBefore: 4, redDaysAfter: 6 },
};

function view(n: number, standing: MemberView["standing"] = "paid"): MemberView {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    memberNo: `MEMBR${n}`,
    barcode: `CODE${n}`,
    name: `Member ${n}`,
    email: `m${n}@example.test`,
    phone: null,
    photoRef: null,
    status: "active",
    plan: {
      id: "plan",
      key: "default",
      name: "Default",
      admissionFee: 0,
      monthlyFee: 5000,
      isActive: true,
    },
    joinedOn: "2026-01-01",
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

function harness(rows: MemberListRow[], tenant: Tenant | null = TENANT) {
  const requests: { request: MemberPageRequest; context: MemberQueryContext }[] = [];
  const finds: { id: string; context: MemberQueryContext }[] = [];
  const unit: MemberQueryUnit = {
    members: {
      find: async (id, context) => {
        finds.push({ id, context });
        return rows.find((row) => row.member.id === id)?.member ?? null;
      },
      findMany: async (ids) =>
        rows.filter((row) => ids.includes(row.member.id)).map((row) => row.member),
      list: async (request, context) => {
        requests.push({ request, context });
        return rows;
      },
    },
    tenants: { find: async () => tenant },
  };
  const deps = {
    withUnit: async <T>(_t: string, fn: (u: MemberQueryUnit) => Promise<T>) => fn(unit),
    clock: CLOCK,
  };
  return { deps, requests, finds };
}

const row = (n: number, standing: MemberView["standing"] = "paid"): MemberListRow => ({
  member: view(n, standing),
  sortName: `member ${n}`,
});

describe("listing members", () => {
  it("reads one row more than the page to learn whether there is a next page", async () => {
    const h = harness([row(1), row(2), row(3)]);
    const result = await makeListMembers(h.deps)({ limit: 2, search: " ada " }, CTX);
    expect(h.requests[0]?.request).toEqual({ search: "ada", limit: 3, after: null });
    if (!result.ok) throw new Error("expected a page");
    expect(result.value.items.map((item) => item.memberNo)).toEqual(["MEMBR1", "MEMBR2"]);
    expect(result.value.nextCursor).not.toBeNull();
  });

  it("gives the sort key of the last row as the cursor, and reads it back", async () => {
    const h = harness([row(1, "overdue"), row(2, "overdue"), row(3)]);
    const first = await makeListMembers(h.deps)({ limit: 2 }, CTX);
    if (!first.ok || first.value.nextCursor === null) throw new Error("expected a cursor");
    await makeListMembers(h.deps)({ limit: 2, cursor: first.value.nextCursor }, CTX);
    expect(h.requests[1]?.request.after).toEqual({
      rank: 0,
      sortName: "member 2",
      id: view(2).id,
    });
  });

  it("has no next cursor on the last page", async () => {
    const h = harness([row(1), row(2)]);
    const result = await makeListMembers(h.deps)({ limit: 2 }, CTX);
    expect(result.ok && result.value.nextCursor).toBeNull();
    const empty = await makeListMembers(harness([]).deps)({}, CTX);
    expect(empty).toEqual({ ok: true, value: { items: [], nextCursor: null } });
  });

  it("derives the gym's dates and thresholds once", async () => {
    const h = harness([]);
    await makeListMembers(h.deps)({}, CTX);
    expect(h.requests[0]?.context).toEqual({
      today: "2026-11-16",
      warnDaysBefore: 4,
      redDaysAfter: 6,
      lastMonthStart: "2026-10-01",
      thisMonthStart: "2026-11-01",
      nextMonthStart: "2026-12-01",
    });
  });

  it("refuses bad input before the database", async () => {
    const h = harness([]);
    const result = await makeListMembers(h.deps)({ search: "x".repeat(65) }, CTX);
    expect(!result.ok && result.error.kind).toBe("validation");
    expect(h.requests).toEqual([]);
  });

  it("is for staff and owners only", async () => {
    const h = harness([]);
    const result = await makeListMembers(h.deps)({}, { ...CTX, roles: ["member"] });
    expect(!result.ok && result.error.kind).toBe("forbidden");
    expect(h.requests).toEqual([]);
  });

  it("throws when the gym row cannot be read", async () => {
    await expect(makeListMembers(harness([], null).deps)({}, CTX)).rejects.toThrow(
      "The gym of this transaction cannot be read",
    );
  });
});

describe("reading one member", () => {
  it("returns the member", async () => {
    const h = harness([row(1)]);
    const result = await makeGetMember(h.deps)({ memberId: view(1).id }, CTX);
    expect(result.ok && result.value.memberNo).toBe("MEMBR1");
    expect(h.finds[0]?.context.today).toBe("2026-11-16");
  });

  it("returns not found for an unknown member", async () => {
    const result = await makeGetMember(harness([]).deps)({ memberId: view(9).id }, CTX);
    expect(!result.ok && result.error.kind).toBe("not_found");
  });

  it("rejects an id that is not a uuid", async () => {
    const result = await makeGetMember(harness([]).deps)({ memberId: "nope" }, CTX);
    expect(!result.ok && result.error.kind).toBe("validation");
  });

  it("is for staff and owners only", async () => {
    const result = await makeGetMember(harness([row(1)]).deps)(
      { memberId: view(1).id },
      { ...CTX, roles: ["member"] },
    );
    expect(!result.ok && result.error.kind).toBe("forbidden");
  });
});
