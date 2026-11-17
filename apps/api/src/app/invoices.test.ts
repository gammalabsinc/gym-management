import { describe, expect, it } from "vitest";
import type { Discount } from "../domain/discounts";
import type { InvoiceDraft } from "../domain/invoice-build";
import type { Tenant } from "../domain/tenant";
import { brandingFromJson, DEFAULT_SETTINGS } from "../domain/tenant";
import {
  INVOICE_GENERATED,
  type InvoiceContext,
  type InvoiceDeps,
  makeGenerateInvoices,
} from "./invoices";
import type { AuditEvent, BillableMember, InvoiceStore, InvoiceUnit, PlanFees } from "./ports";

const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-16T15:00:00.000Z");

const CTX: InvoiceContext = { tenantId: TENANT_ID, actorUserId: ACTOR_ID, requestId: "req-1" };

const TENANT: Tenant = {
  id: TENANT_ID,
  name: "Gym",
  subdomain: "gym",
  timezone: "America/Toronto",
  currency: "CAD",
  branding: brandingFromJson({}),
  settings: DEFAULT_SETTINGS,
};

const MEMBER: BillableMember = {
  id: MEMBER_ID,
  billingDay: 15,
  status: "active",
  planId: "plan-1",
  activeFrom: "2026-11-15",
};

function discount(overrides: Partial<Discount> = {}): Discount {
  return {
    id: "d1",
    amount: 1000,
    isRecurring: true,
    startsOn: "2026-01-01",
    endsOn: null,
    isActive: true,
    consumedInvoiceId: null,
    createdAt: "2026-01-01T00:00:00.000000Z",
    ...overrides,
  };
}

interface World {
  tenant?: Tenant | null;
  member?: BillableMember | null;
  fees?: PlanFees | null;
  lastPeriodEnd?: string | null;
  discounts?: Discount[];
  /** Cycle starts that the store refuses as already invoiced. */
  alreadyInvoiced?: string[];
  now?: Date;
}

function setup(world: World = {}) {
  const inserted: { memberId: string; draft: InvoiceDraft; id: string }[] = [];
  const consumed: { ids: readonly string[]; invoiceId: string }[] = [];
  const audit: AuditEvent[] = [];
  const touchedTenants: string[] = [];
  const invoices: InvoiceStore = {
    lockMember: async () => (world.member === undefined ? MEMBER : world.member),
    findPlanFees: async () =>
      world.fees === undefined ? { admissionFee: 2000, monthlyFee: 5000 } : world.fees,
    lastPeriodEnd: async () => world.lastPeriodEnd ?? null,
    discountsOf: async () => world.discounts ?? [],
    insert: async (memberId, draft) => {
      if (world.alreadyInvoiced?.includes(draft.periodStart)) return null;
      const id = `invoice-${inserted.length + 1}`;
      inserted.push({ memberId, draft, id });
      return id;
    },
    markConsumed: async (ids, invoiceId) => {
      consumed.push({ ids, invoiceId });
    },
  };
  const unit: InvoiceUnit = {
    invoices,
    tenants: { find: async () => (world.tenant === undefined ? TENANT : world.tenant) },
    audit: {
      record: async (event) => {
        audit.push(event);
      },
    },
  };
  const deps: InvoiceDeps = {
    clock: { now: () => world.now ?? NOW },
    withUnit: async (tenantId, fn) => {
      touchedTenants.push(tenantId);
      return fn(unit);
    },
  };
  return { generate: makeGenerateInvoices(deps), inserted, consumed, audit, touchedTenants };
}

describe("generating invoices", () => {
  it("builds the first invoice of a new member with the admission fee, in the member's gym", async () => {
    const { generate, inserted, touchedTenants } = setup();
    const result = await generate({ memberId: MEMBER_ID, ahead: 0 }, CTX);
    expect(result).toEqual({
      ok: true,
      value: {
        invoices: [
          { id: "invoice-1", periodStart: "2026-11-15", periodEnd: "2026-12-14", total: 7000 },
        ],
      },
    });
    expect(touchedTenants).toEqual([TENANT_ID]);
    expect(inserted[0]?.memberId).toBe(MEMBER_ID);
    expect(inserted[0]?.draft.lines.map((line) => line.lineType)).toEqual([
      "membership",
      "admission",
    ]);
  });

  it("builds up to 12 cycles ahead, with the admission fee on the first invoice only", async () => {
    const { generate, inserted } = setup();
    const result = await generate({ memberId: MEMBER_ID, ahead: 12 }, CTX);
    expect(result.ok && result.value.invoices).toHaveLength(13);
    expect(inserted.map((entry) => entry.draft.total)).toEqual([7000, ...Array(12).fill(5000)]);
  });

  it("writes one audit event per invoice with the actor and request id", async () => {
    const { generate, audit } = setup();
    await generate({ memberId: MEMBER_ID, ahead: 1 }, CTX);
    expect(audit).toHaveLength(2);
    expect(audit[0]).toEqual({
      actorUserId: ACTOR_ID,
      action: INVOICE_GENERATED,
      entityType: "invoice",
      entityId: "invoice-1",
      before: null,
      after: {
        memberId: MEMBER_ID,
        periodStart: "2026-11-15",
        periodEnd: "2026-12-14",
        total: 7000,
        lines: 2,
      },
      requestId: "req-1",
    });
  });

  it("records no actor for a job", async () => {
    const { generate, audit } = setup();
    await generate({ memberId: MEMBER_ID, ahead: 0 }, { ...CTX, actorUserId: null });
    expect(audit[0]?.actorUserId).toBeNull();
  });

  it("builds nothing when every cycle is already invoiced", async () => {
    const { generate, inserted, audit } = setup({ lastPeriodEnd: "2026-12-14" });
    const result = await generate({ memberId: MEMBER_ID, ahead: 0 }, CTX);
    expect(result).toEqual({ ok: true, value: { invoices: [] } });
    expect(inserted).toEqual([]);
    expect(audit).toEqual([]);
  });

  it("leaves the admission fee off when the member already has an invoice", async () => {
    const { generate, inserted } = setup({ lastPeriodEnd: "2026-11-14", member: { ...MEMBER } });
    await generate({ memberId: MEMBER_ID, ahead: 0 }, CTX);
    expect(inserted[0]?.draft.total).toBe(5000);
  });

  it("gives no invoice to a paused or cancelled member", async () => {
    for (const status of ["paused", "cancelled"] as const) {
      const { generate, inserted } = setup({ member: { ...MEMBER, status } });
      const result = await generate({ memberId: MEMBER_ID, ahead: 3 }, CTX);
      expect(result).toEqual({ ok: true, value: { invoices: [] } });
      expect(inserted).toEqual([]);
    }
  });

  it("applies a recurring discount to every invoice and uses a one time discount once", async () => {
    const { generate, inserted, consumed } = setup({
      discounts: [
        discount({ id: "always", createdAt: "2026-01-01T00:00:00.000000Z" }),
        discount({ id: "once", isRecurring: false, createdAt: "2026-02-01T00:00:00.000000Z" }),
      ],
    });
    await generate({ memberId: MEMBER_ID, ahead: 2 }, CTX);
    expect(inserted.map((entry) => entry.draft.total)).toEqual([5000, 4000, 4000]);
    expect(consumed).toEqual([
      { ids: ["once"], invoiceId: "invoice-1" },
      { ids: [], invoiceId: "invoice-2" },
      { ids: [], invoiceId: "invoice-3" },
    ]);
  });

  it("does not use up a one time discount for a cycle that was already invoiced", async () => {
    const { generate, inserted, consumed, audit } = setup({
      discounts: [discount({ id: "once", isRecurring: false })],
      alreadyInvoiced: ["2026-11-15"],
    });
    const result = await generate({ memberId: MEMBER_ID, ahead: 1 }, CTX);
    expect(result.ok && result.value.invoices.map((invoice) => invoice.periodStart)).toEqual([
      "2026-12-15",
    ]);
    // The skipped cycle was not the first invoice written, so the admission fee goes on this one.
    expect(inserted[0]?.draft.total).toBe(6000);
    expect(consumed).toEqual([{ ids: ["once"], invoiceId: "invoice-1" }]);
    expect(audit).toHaveLength(1);
  });

  it("reads today in the gym's time zone, not the UTC date", async () => {
    // 03:00 UTC on 17 November is still 16 November in Toronto, so the 17 November cycle is not due.
    const world = { member: { ...MEMBER, billingDay: 17, activeFrom: "2026-11-17" } };
    const toronto = setup({ ...world, now: new Date("2026-11-17T03:00:00.000Z") });
    expect(await toronto.generate({ memberId: MEMBER_ID, ahead: 0 }, CTX)).toEqual({
      ok: true,
      value: { invoices: [] },
    });
    const tokyo = setup({
      ...world,
      tenant: { ...TENANT, timezone: "Asia/Tokyo" },
      now: new Date("2026-11-17T03:00:00.000Z"),
    });
    const result = await tokyo.generate({ memberId: MEMBER_ID, ahead: 0 }, CTX);
    expect(result.ok && result.value.invoices).toHaveLength(1);
  });

  it("refuses a member id that is not a uuid, before opening a transaction", async () => {
    const { generate, touchedTenants } = setup();
    const result = await generate({ memberId: "not-a-uuid", ahead: 0 }, CTX);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("validation");
    expect(touchedTenants).toEqual([]);
  });

  it("refuses a number of cycles ahead outside 0 to 12", async () => {
    const { generate, inserted } = setup();
    const result = await generate({ memberId: MEMBER_ID, ahead: 13 }, CTX);
    expect(!result.ok && result.error.kind).toBe("validation");
    expect(inserted).toEqual([]);
  });

  it("answers not found for a member the gym does not have", async () => {
    const { generate, inserted } = setup({ member: null });
    const result = await generate({ memberId: MEMBER_ID, ahead: 0 }, CTX);
    expect(result).toEqual({
      ok: false,
      error: { kind: "not_found", message: "Member not found" },
    });
    expect(inserted).toEqual([]);
  });

  it("returns the error of an invoice it cannot build", async () => {
    const { generate } = setup({ fees: { admissionFee: 0, monthlyFee: -5 } });
    const result = await generate({ memberId: MEMBER_ID, ahead: 0 }, CTX);
    expect(!result.ok && result.error.kind).toBe("validation");
  });

  it("throws when the rows a transaction should always hold are missing", async () => {
    await expect(
      setup({ tenant: null }).generate({ memberId: MEMBER_ID, ahead: 0 }, CTX),
    ).rejects.toThrow("gym of this transaction");
    await expect(
      setup({ fees: null }).generate({ memberId: MEMBER_ID, ahead: 0 }, CTX),
    ).rejects.toThrow("plan of a membership period");
  });
});
