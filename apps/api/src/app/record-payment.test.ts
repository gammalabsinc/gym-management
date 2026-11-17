import { describe, expect, it } from "vitest";
import type { InvoiceDraft } from "../domain/invoice-build";
import { brandingFromJson, DEFAULT_SETTINGS, type Tenant } from "../domain/tenant";
import type { AuditEvent, BillableMember, PaymentUnit, PlanFees } from "./ports";
import { makeRecordPayment, type RecordPaymentContext } from "./record-payment";

const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-11-16T15:00:00.000Z");

const CTX: RecordPaymentContext = {
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

const MEMBER: BillableMember = {
  id: MEMBER_ID,
  billingDay: 10,
  status: "active",
  planId: "plan-1",
  activeFrom: "2026-11-10",
};

const GOOD: PlanFees = { admissionFee: 2000, monthlyFee: 5000 };
const BROKEN: PlanFees = { admissionFee: 0, monthlyFee: -5 };

interface World {
  tenant?: Tenant | null;
  /** The fees each read of the plan gets, in order. The last one repeats. */
  fees?: PlanFees[];
}

function setup(world: World = {}) {
  const feeReads = [...(world.fees ?? [GOOD])];
  const inserted: InvoiceDraft[] = [];
  const allocated: { paymentId: string; invoiceIds: string[] }[] = [];
  const audit: AuditEvent[] = [];
  let lastPeriodEnd: string | null = null;
  const unit: PaymentUnit = {
    invoices: {
      lockMember: async () => MEMBER,
      findPlanFees: async () => (feeReads.length > 1 ? feeReads.shift() : feeReads[0]) ?? GOOD,
      lastPeriodEnd: async () => lastPeriodEnd,
      discountsOf: async () => [],
      insert: async (_memberId, draft) => {
        inserted.push(draft);
        lastPeriodEnd = draft.periodEnd;
        return `invoice-${inserted.length}`;
      },
      markConsumed: async () => {},
    },
    tenants: { find: async () => (world.tenant === undefined ? TENANT : world.tenant) },
    audit: {
      record: async (event) => {
        audit.push(event);
      },
    },
    payments: {
      findByRequestId: async () => null,
      unpaidInvoices: async () => [],
      ledger: async () => [],
      insert: async () => ({ id: "payment-1", submittedAt: "2026-11-16T15:00:00.000000Z" }),
      insertAllocations: async (paymentId, allocations) => {
        allocated.push({ paymentId, invoiceIds: allocations.map((a) => a.invoiceId) });
      },
    },
  };
  const record = makeRecordPayment({
    clock: { now: () => NOW },
    withUnit: (_tenantId, fn) => fn(unit),
  });
  return { record, inserted, allocated, audit };
}

const request = (amount: number) => ({
  clientRequestId: REQUEST_ID,
  memberId: MEMBER_ID,
  amount,
  method: "cash",
});

describe("makeRecordPayment with the rows it reads faked", () => {
  it("throws when the gym row of the transaction is missing", async () => {
    await expect(setup({ tenant: null }).record(request(1000), CTX)).rejects.toThrow(
      "gym of this transaction",
    );
  });

  it("returns the error of an invoice that is due but cannot be built, and writes no allocation", async () => {
    const { record, allocated, audit } = setup({ fees: [BROKEN] });
    const result = await record(request(1000), CTX);
    expect(!result.ok && result.error.kind).toBe("validation");
    expect(allocated).toEqual([]);
    expect(audit).toEqual([]);
  });

  it("returns the error of a next invoice it cannot work out", async () => {
    const { record, allocated } = setup({ fees: [GOOD, BROKEN] });
    const result = await record(request(20000), CTX);
    expect(!result.ok && result.error.kind).toBe("validation");
    expect(allocated).toEqual([]);
  });

  it("returns the error of a next invoice it cannot build after working out its total", async () => {
    const { record, allocated } = setup({ fees: [GOOD, GOOD, BROKEN] });
    const result = await record(request(20000), CTX);
    expect(!result.ok && result.error.kind).toBe("validation");
    expect(allocated).toEqual([]);
  });

  it("settles nothing for invoices that cost nothing, and keeps the whole payment as credit", async () => {
    const { record, inserted, allocated } = setup({ fees: [{ admissionFee: 0, monthlyFee: 0 }] });
    const result = await record(request(1000), CTX);
    expect(result).toMatchObject({ ok: true, value: { allocations: [], credit: 1000 } });
    expect(inserted).toHaveLength(13);
    expect(allocated).toEqual([{ paymentId: "payment-1", invoiceIds: [] }]);
  });
});
