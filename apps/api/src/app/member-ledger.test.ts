import { describe, expect, it } from "vitest";
import { encodeLedgerCursor } from "../domain/member-ledger";
import { brandingFromJson, DEFAULT_SETTINGS, type Tenant } from "../domain/tenant";
import {
  type LedgerCaller,
  makeMemberDiscounts,
  makeMemberInvoices,
  makeMemberPayments,
  makeMembershipHistory,
} from "./member-ledger";
import type {
  LedgerDiscountRow,
  LedgerInvoiceRow,
  LedgerPageRequest,
  LedgerPaymentRow,
  LedgerPeriodRow,
  LedgerUnit,
} from "./ports";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_MEMBER_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
/** Half past ten in the evening on 16 November in Toronto, already the 17th in UTC. */
const NOW = new Date("2026-11-17T03:30:00.000Z");
const CLOCK = { now: () => NOW };

const STAFF: LedgerCaller = { roles: ["staff"], tenantId: TENANT_ID, userId: USER_ID };
const OWNER: LedgerCaller = { roles: ["owner"], tenantId: TENANT_ID, userId: USER_ID };
const MEMBER: LedgerCaller = { roles: ["member"], tenantId: TENANT_ID, userId: USER_ID };
const NOBODY: LedgerCaller = { roles: [], tenantId: TENANT_ID, userId: USER_ID };

const TENANT: Tenant = {
  id: TENANT_ID,
  name: "Gym",
  subdomain: "gym",
  timezone: "America/Toronto",
  currency: "CAD",
  branding: brandingFromJson({}),
  settings: DEFAULT_SETTINGS,
};

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function invoice(n: number, overrides: Partial<LedgerInvoiceRow> = {}): LedgerInvoiceRow {
  return {
    id: id(n),
    periodStart: "2026-11-01",
    periodEnd: "2026-11-30",
    dueDate: "2026-11-01",
    total: 5000,
    amountDue: 5000,
    isVoid: false,
    voidReason: null,
    lines: [{ type: "membership", description: "Monthly fee", amount: 5000 }],
    ...overrides,
  };
}

function payment(n: number): LedgerPaymentRow {
  return {
    id: id(n),
    amount: 5000,
    method: "cash",
    paidOn: "2026-11-02",
    recordedAt: "2026-11-02T15:00:00.000000Z",
    recordedByName: "Sam Staff",
    isVoid: false,
    voidReason: null,
  };
}

function discount(n: number, overrides: Partial<LedgerDiscountRow> = {}): LedgerDiscountRow {
  return {
    id: id(n),
    kind: "manual",
    referralSide: null,
    sourceMemberName: null,
    amount: 500,
    isRecurring: true,
    reason: "Friend of the owner",
    startsOn: "2026-10-01",
    endsOn: null,
    isActive: true,
    consumedInvoiceId: null,
    ...overrides,
  };
}

function period(n: number): LedgerPeriodRow {
  return {
    id: id(n),
    status: "active",
    planId: id(900),
    planName: "Default",
    validFrom: "2026-09-01",
    validTo: null,
    reason: null,
  };
}

interface World {
  invoices?: LedgerInvoiceRow[];
  payments?: LedgerPaymentRow[];
  discounts?: LedgerDiscountRow[];
  periods?: LedgerPeriodRow[];
  memberExists?: boolean;
  ownMemberId?: string | null;
  tenant?: Tenant | null;
}

function setup(world: World = {}) {
  const calls = { pages: [] as { memberId: string; page: LedgerPageRequest }[], exists: 0 };
  const read = <T>(rows: T[] | undefined) => {
    return async (memberId: string, page: LedgerPageRequest) => {
      calls.pages.push({ memberId, page });
      return rows ?? [];
    };
  };
  const unit: LedgerUnit = {
    ledger: {
      invoices: read(world.invoices),
      payments: read(world.payments),
      discounts: read(world.discounts),
      periods: read(world.periods),
    },
    members: {
      findIdByUser: async () => (world.ownMemberId === undefined ? MEMBER_ID : world.ownMemberId),
      exists: async () => {
        calls.exists += 1;
        return world.memberExists ?? true;
      },
    },
    tenants: { find: async () => (world.tenant === undefined ? TENANT : world.tenant) },
  };
  const deps = {
    withUnit: (_t: string, fn: (u: LedgerUnit) => Promise<unknown>) => fn(unit),
    clock: CLOCK,
  };
  // The cast is confined to this test double, which only needs to run the callback.
  const typed = deps as unknown as Parameters<typeof makeMemberInvoices>[0];
  return { calls, deps: typed };
}

const ALL = [
  ["invoices", makeMemberInvoices],
  ["payments", makeMemberPayments],
  ["discounts", makeMemberDiscounts],
  ["membership history", makeMembershipHistory],
] as const;

describe.each(ALL)("%s list", (_name, make) => {
  it("refuses a caller with no role", async () => {
    const { deps, calls } = setup();
    const result = await make(deps)({ memberId: MEMBER_ID }, NOBODY);
    expect(result).toMatchObject({ ok: false, error: { kind: "forbidden" } });
    expect(calls.pages).toEqual([]);
  });

  it("refuses a bad member id before reading anything", async () => {
    const { deps, calls } = setup();
    const result = await make(deps)({ memberId: "nope" }, STAFF);
    expect(result).toMatchObject({ ok: false, error: { kind: "validation" } });
    expect(calls.pages).toEqual([]);
  });

  it("lets staff and owners read any member of the gym", async () => {
    for (const caller of [STAFF, OWNER]) {
      const { deps, calls } = setup({ ownMemberId: OTHER_MEMBER_ID });
      const result = await make(deps)({ memberId: MEMBER_ID }, caller);
      expect(result).toMatchObject({ ok: true });
      expect(calls.pages).toHaveLength(1);
    }
  });

  it("says not found when staff ask for a member the gym does not have", async () => {
    const { deps, calls } = setup({ memberExists: false });
    const result = await make(deps)({ memberId: MEMBER_ID }, STAFF);
    expect(result).toMatchObject({ ok: false, error: { kind: "not_found" } });
    expect(calls.pages).toEqual([]);
  });

  it("lets a member read their own record", async () => {
    const { deps, calls } = setup();
    const result = await make(deps)({ memberId: MEMBER_ID }, MEMBER);
    expect(result).toMatchObject({ ok: true });
    expect(calls.exists).toBe(0);
  });

  it("shows a member nothing of anyone else, and the answer matches an unknown id", async () => {
    const { deps, calls } = setup();
    const result = await make(deps)({ memberId: OTHER_MEMBER_ID }, MEMBER);
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "not_found", message: "Member not found" },
    });
    expect(calls.pages).toEqual([]);
  });

  it("says not found to a user who has no member row", async () => {
    const { deps } = setup({ ownMemberId: null });
    const result = await make(deps)({ memberId: MEMBER_ID }, MEMBER);
    expect(result).toMatchObject({ ok: false, error: { kind: "not_found" } });
  });

  it("fails loudly when the gym of the transaction cannot be read", async () => {
    const { deps } = setup({ tenant: null });
    await expect(make(deps)({ memberId: MEMBER_ID }, STAFF)).rejects.toThrow(/cannot be read/);
  });

  it("caps the page size and reads one extra row to know whether a next page exists", async () => {
    const { deps, calls } = setup();
    await make(deps)({ memberId: MEMBER_ID, limit: 100000 }, STAFF);
    expect(calls.pages[0]?.page).toEqual({ limit: 101, after: null });
  });

  it("starts after the cursor", async () => {
    const { deps, calls } = setup();
    const cursor = encodeLedgerCursor({ date: "2026-10-01", id: id(7) });
    await make(deps)({ memberId: MEMBER_ID, cursor, limit: 5 }, STAFF);
    expect(calls.pages[0]?.page).toEqual({ limit: 6, after: { date: "2026-10-01", id: id(7) } });
  });

  it("refuses a cursor that is not one of ours", async () => {
    const { deps } = setup();
    const result = await make(deps)({ memberId: MEMBER_ID, cursor: "junk" }, STAFF);
    expect(result).toMatchObject({ ok: false, error: { kind: "validation" } });
  });
});

describe("invoices", () => {
  it("derives the status from the shared rule and zeroes what a voided invoice owes", async () => {
    const { deps } = setup({
      invoices: [
        invoice(1, { periodStart: "2026-12-01", dueDate: "2026-12-01" }),
        invoice(2),
        invoice(3, { amountDue: 0 }),
        invoice(4, { isVoid: true, voidReason: "Entered twice" }),
      ],
    });
    const result = await makeMemberInvoices(deps)({ memberId: MEMBER_ID }, STAFF);
    if (!result.ok) throw new Error("expected a page");
    expect(result.value.items.map((i) => [i.status, i.amountOwing])).toEqual([
      ["upcoming", 5000],
      ["unpaid", 5000],
      ["paid", 0],
      ["voided", 0],
    ]);
    expect(result.value.items[3]).toMatchObject({ voidReason: "Entered twice" });
    expect(result.value.items[0]?.lines).toEqual([
      { type: "membership", description: "Monthly fee", amount: 5000 },
    ]);
  });

  it("judges due by the gym's date, not the UTC date", async () => {
    // 03:30 UTC on the 17th is still the 16th in Toronto, so an invoice due on the 17th is upcoming.
    const { deps } = setup({ invoices: [invoice(1, { dueDate: "2026-11-17" })] });
    const result = await makeMemberInvoices(deps)({ memberId: MEMBER_ID }, STAFF);
    if (!result.ok) throw new Error("expected a page");
    expect(result.value.items[0]?.status).toBe("upcoming");
  });

  it("returns a cursor for the last row of a full page and none on the last page", async () => {
    const rows = [invoice(1), invoice(2), invoice(3, { periodStart: "2026-09-01" })];
    const { deps } = setup({ invoices: rows });
    const first = await makeMemberInvoices(deps)({ memberId: MEMBER_ID, limit: 2 }, STAFF);
    if (!first.ok) throw new Error("expected a page");
    expect(first.value.items).toHaveLength(2);
    expect(first.value.nextCursor).toBe(encodeLedgerCursor({ date: "2026-11-01", id: id(2) }));
    const last = await makeMemberInvoices(deps)({ memberId: MEMBER_ID, limit: 3 }, STAFF);
    if (!last.ok) throw new Error("expected a page");
    expect(last.value).toMatchObject({ nextCursor: null });
    expect(last.value.items).toHaveLength(3);
  });

  it("returns an empty page with no cursor", async () => {
    const { deps } = setup();
    expect(await makeMemberInvoices(deps)({ memberId: MEMBER_ID }, STAFF)).toEqual({
      ok: true,
      value: { items: [], nextCursor: null },
    });
  });
});

describe("payments, discounts and history", () => {
  it("pages payments by the date they were received", async () => {
    const { deps } = setup({ payments: [payment(1), payment(2)] });
    const result = await makeMemberPayments(deps)({ memberId: MEMBER_ID, limit: 1 }, STAFF);
    if (!result.ok) throw new Error("expected a page");
    expect(result.value.items).toEqual([payment(1)]);
    expect(result.value.nextCursor).toBe(encodeLedgerCursor({ date: "2026-11-02", id: id(1) }));
  });

  it("derives discount status as active, consumed or ended", async () => {
    const { deps } = setup({
      discounts: [
        discount(1),
        discount(2, { isRecurring: false, consumedInvoiceId: id(50) }),
        discount(3, { endsOn: "2026-11-15" }),
        discount(4, { isActive: false }),
        discount(5, { endsOn: "2026-11-16" }),
      ],
    });
    const result = await makeMemberDiscounts(deps)({ memberId: MEMBER_ID }, STAFF);
    if (!result.ok) throw new Error("expected a page");
    expect(result.value.items.map((d) => d.status)).toEqual([
      "active",
      "consumed",
      "ended",
      "ended",
      "active",
    ]);
  });

  it("pages membership history by the day each period began", async () => {
    const { deps } = setup({ periods: [period(1), period(2)] });
    const result = await makeMembershipHistory(deps)({ memberId: MEMBER_ID, limit: 1 }, STAFF);
    if (!result.ok) throw new Error("expected a page");
    expect(result.value.items).toEqual([period(1)]);
    expect(result.value.nextCursor).toBe(encodeLedgerCursor({ date: "2026-09-01", id: id(1) }));
  });
});
