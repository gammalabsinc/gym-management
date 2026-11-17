import { describe, expect, it } from "vitest";
import type { LedgerInvoice } from "../domain/payment";
import { brandingFromJson, DEFAULT_SETTINGS, type Tenant } from "../domain/tenant";
import type { BillableMember, PaymentUnit, PlanFees } from "./ports";
import { makePreviewPayment, type PreviewPaymentContext } from "./preview-payment";

const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-11-16T15:00:00.000Z");

const CTX: PreviewPaymentContext = {
  roles: ["staff"],
  tenantId: TENANT_ID,
  userId: "33333333-3333-4333-8333-333333333333",
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
const FREE: PlanFees = { admissionFee: 0, monthlyFee: 0 };

const OCT: LedgerInvoice = {
  invoiceId: "inv-oct",
  periodStart: "2026-10-10",
  periodEnd: "2026-11-09",
  dueDate: "2026-10-10",
  amountDue: 3000,
};

interface World {
  tenant?: Tenant | null;
  member?: BillableMember | null;
  ledger?: LedgerInvoice[];
  lastPeriodEnd?: string | null;
  /** The fees each read of the plan gets, in order. The last one repeats. */
  fees?: PlanFees[];
}

function setup(world: World = {}) {
  const feeReads = [...(world.fees ?? [GOOD])];
  const realWrites: string[] = [];
  const unit: PaymentUnit = {
    invoices: {
      lockMember: async () => (world.member === undefined ? MEMBER : world.member),
      findPlanFees: async () => (feeReads.length > 1 ? feeReads.shift() : feeReads[0]) ?? GOOD,
      lastPeriodEnd: async () => (world.lastPeriodEnd === undefined ? null : world.lastPeriodEnd),
      discountsOf: async () => [],
      insert: async () => {
        realWrites.push("invoice");
        return null;
      },
      markConsumed: async () => {
        realWrites.push("consumed");
      },
    },
    tenants: { find: async () => (world.tenant === undefined ? TENANT : world.tenant) },
    audit: {
      record: async () => {
        realWrites.push("audit");
      },
    },
    payments: {
      findByRequestId: async () => null,
      unpaidInvoices: async () => [],
      ledger: async () => world.ledger ?? [],
      insert: async () => {
        realWrites.push("payment");
        return null;
      },
      insertAllocations: async () => {
        realWrites.push("allocations");
      },
    },
  };
  const preview = makePreviewPayment({
    clock: { now: () => NOW },
    withUnit: (_tenantId, fn) => fn(unit),
  });
  return { preview, realWrites };
}

const ask = (amount?: number | null) => ({ memberId: MEMBER_ID, amount });

describe("makePreviewPayment", () => {
  it("settles the oldest invoice first, builds the invoice that is due, and writes nothing", async () => {
    const { preview, realWrites } = setup({ ledger: [OCT] });
    const result = await preview(ask(5000), CTX);
    expect(result).toEqual({
      ok: true,
      value: {
        amount: 5000,
        suggestedAmount: 10000,
        allocations: [
          {
            invoiceId: "inv-oct",
            periodStart: "2026-10-10",
            periodEnd: "2026-11-09",
            amount: 3000,
          },
          {
            invoiceId: null,
            periodStart: "2026-11-10",
            periodEnd: "2026-12-09",
            amount: 2000,
          },
        ],
        paidThroughAfter: "2026-11-09",
        creditAfter: 0,
      },
    });
    expect(realWrites).toEqual([]);
  });

  it("builds the cycles ahead that the money covers and keeps the rest as credit", async () => {
    const { preview, realWrites } = setup({ ledger: [OCT] });
    const result = await preview(ask(22000), CTX);
    expect(result.ok && result.value.allocations.map((a) => a.periodStart)).toEqual([
      "2026-10-10",
      "2026-11-10",
      "2026-12-10",
      "2027-01-10",
    ]);
    expect(result.ok && result.value.creditAfter).toBe(2000);
    expect(result.ok && result.value.paidThroughAfter).toBe("2027-02-09");
    expect(realWrites).toEqual([]);
  });

  it("previews the suggested amount when none is given", async () => {
    const { preview } = setup({ ledger: [OCT] });
    const result = await preview(ask(), CTX);
    expect(result.ok && result.value).toMatchObject({ amount: 10000, suggestedAmount: 10000 });
    expect(result.ok && result.value.allocations.map((a) => a.amount)).toEqual([3000, 7000]);
  });

  it("suggests the oldest open invoice when nothing is due yet", async () => {
    const future: LedgerInvoice = {
      invoiceId: "inv-dec",
      periodStart: "2026-12-10",
      periodEnd: "2027-01-09",
      dueDate: "2026-12-10",
      amountDue: 4000,
    };
    const paid: LedgerInvoice = { ...OCT, amountDue: 0 };
    const nov: LedgerInvoice = {
      invoiceId: "inv-nov",
      periodStart: "2026-11-10",
      periodEnd: "2026-12-09",
      dueDate: "2026-11-10",
      amountDue: 0,
    };
    const { preview } = setup({ ledger: [paid, nov, future], lastPeriodEnd: "2027-01-09" });
    const result = await preview(ask(), CTX);
    expect(result.ok && result.value.suggestedAmount).toBe(4000);
  });

  it("suggests the next invoice when every invoice is paid", async () => {
    const nov: LedgerInvoice = {
      invoiceId: "inv-nov",
      periodStart: "2026-11-10",
      periodEnd: "2026-12-09",
      dueDate: "2026-11-10",
      amountDue: 0,
    };
    const { preview } = setup({ ledger: [nov], lastPeriodEnd: "2026-12-09" });
    const result = await preview(ask(), CTX);
    expect(result.ok && result.value).toMatchObject({
      suggestedAmount: 5000,
      amount: 5000,
      paidThroughAfter: "2027-01-09",
    });
    expect(result.ok && result.value.allocations).toEqual([
      { invoiceId: null, periodStart: "2026-12-10", periodEnd: "2027-01-09", amount: 5000 },
    ]);
  });

  it("asks for an amount when nothing is due and none was given", async () => {
    const { preview } = setup({
      member: { ...MEMBER, status: "paused" },
      ledger: [{ ...OCT, amountDue: 0 }],
    });
    const result = await preview(ask(), CTX);
    expect(result).toMatchObject({ ok: false, error: { kind: "validation" } });
  });

  it("asks for an amount when the next invoice costs nothing", async () => {
    const nov: LedgerInvoice = {
      invoiceId: "inv-nov",
      periodStart: "2026-11-10",
      periodEnd: "2026-12-09",
      dueDate: "2026-11-10",
      amountDue: 0,
    };
    const { preview } = setup({ ledger: [nov], lastPeriodEnd: "2026-12-09", fees: [FREE] });
    expect(await preview(ask(), CTX)).toMatchObject({ ok: false, error: { kind: "validation" } });
  });

  it("refuses an amount a payment would refuse", async () => {
    const { preview } = setup();
    expect(await preview(ask(12.5), CTX)).toMatchObject({
      ok: false,
      error: { kind: "validation" },
    });
    expect(await preview({ memberId: "nope", amount: 100 }, CTX)).toMatchObject({
      ok: false,
      error: { kind: "validation" },
    });
  });

  it("says not found for a member the gym does not have", async () => {
    const { preview } = setup({ member: null });
    expect(await preview(ask(1000), CTX)).toMatchObject({
      ok: false,
      error: { kind: "not_found" },
    });
  });

  it("refuses a caller without the payment permission, and says which one it needs", async () => {
    const { preview } = setup();
    expect(await preview(ask(1000), { ...CTX, roles: ["member"] })).toMatchObject({
      ok: false,
      error: { kind: "forbidden" },
    });
    expect(preview.requiredPermission).toBe("payment.record");
  });

  it("throws when the gym row of the transaction is missing", async () => {
    await expect(setup({ tenant: null }).preview(ask(1000), CTX)).rejects.toThrow(
      "gym of this transaction",
    );
  });

  it("returns the error of an invoice that is due but cannot be built", async () => {
    const { preview, realWrites } = setup({ fees: [BROKEN] });
    expect(await preview(ask(1000), CTX)).toMatchObject({
      ok: false,
      error: { kind: "validation" },
    });
    expect(realWrites).toEqual([]);
  });

  it("returns the error of a next invoice it cannot work out while suggesting", async () => {
    const nov: LedgerInvoice = {
      invoiceId: "inv-nov",
      periodStart: "2026-11-10",
      periodEnd: "2026-12-09",
      dueDate: "2026-11-10",
      amountDue: 0,
    };
    const { preview } = setup({ ledger: [nov], lastPeriodEnd: "2026-12-09", fees: [GOOD, BROKEN] });
    expect(await preview(ask(), CTX)).toMatchObject({ ok: false, error: { kind: "validation" } });
  });

  it("returns the error of settling that cannot be worked out", async () => {
    const { preview } = setup({ ledger: [OCT], fees: [GOOD, GOOD, GOOD, BROKEN] });
    expect(await preview(ask(20000), CTX)).toMatchObject({
      ok: false,
      error: { kind: "validation" },
    });
  });
});
