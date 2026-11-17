import { describe, expect, it } from "vitest";
import type {
  BillableMember,
  VoidableInvoice,
  VoidablePayment,
  VoidUnit,
  WithTenantTx,
} from "./ports";
import { makeVoidInvoice, makeVoidPayment, type VoidContext } from "./voids";

const PAYMENT_ID = "11111111-1111-4111-8111-111111111111";
const INVOICE_ID = "22222222-2222-4222-8222-222222222222";
const MEMBER_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-16T15:00:00.000Z");

const CTX: VoidContext = {
  roles: ["owner"],
  tenantId: "44444444-4444-4444-8444-444444444444",
  userId: "55555555-5555-4555-8555-555555555555",
  requestId: "req-1",
};

const MEMBER: BillableMember = {
  id: MEMBER_ID,
  billingDay: 10,
  status: "active",
  planId: "plan-1",
  activeFrom: "2026-11-10",
};

const PAYMENT: VoidablePayment = {
  id: PAYMENT_ID,
  memberId: MEMBER_ID,
  amount: 7000,
  isVoid: false,
  allocations: [{ invoiceId: INVOICE_ID, amount: 7000 }],
};

const INVOICE: VoidableInvoice = {
  id: INVOICE_ID,
  memberId: MEMBER_ID,
  isVoid: false,
  periodStart: "2026-11-10",
  total: 7000,
  counted: 0,
};

interface World {
  /** What each read of the payment gets, in order. The last one repeats. */
  payments?: (VoidablePayment | null)[];
  invoices?: (VoidableInvoice | null)[];
  member?: BillableMember | null;
  /** Whether the update finds a row to void. */
  changes?: boolean;
}

function setup(world: World = {}) {
  const payments = [...(world.payments ?? [PAYMENT])];
  const invoices = [...(world.invoices ?? [INVOICE])];
  const writes: string[] = [];
  const unit: VoidUnit = {
    voids: {
      findPayment: async () => (payments.length > 1 ? payments.shift() : payments[0]) ?? null,
      findInvoice: async () => (invoices.length > 1 ? invoices.shift() : invoices[0]) ?? null,
      voidPayment: async () => {
        writes.push("void-payment");
        return world.changes ?? true;
      },
      voidInvoice: async () => {
        writes.push("void-invoice");
        return world.changes ?? true;
      },
      spareCredits: async () => [],
    },
    payments: {
      unpaidInvoices: async () => [],
      insertAllocations: async () => {
        writes.push("allocations");
      },
    },
    invoices: { lockMember: async () => (world.member === undefined ? MEMBER : world.member) },
    audit: {
      record: async () => {
        writes.push("audit");
      },
    },
  };
  const withUnit: WithTenantTx<VoidUnit> = (_tenantId, fn) => fn(unit);
  const deps = { clock: { now: () => NOW }, withUnit };
  return { voidPayment: makeVoidPayment(deps), voidInvoice: makeVoidInvoice(deps), writes };
}

const payment = { paymentId: PAYMENT_ID, reason: "wrong member" };
const invoice = { invoiceId: INVOICE_ID, reason: "billed twice" };

describe("makeVoidPayment with the rows it reads faked", () => {
  it("names the permission it needs", () => {
    expect(setup().voidPayment.requiredPermission).toBe("payment.void");
  });

  it("writes nothing for a caller who may not void", async () => {
    const { voidPayment, writes } = setup();
    const result = await voidPayment(payment, { ...CTX, roles: ["staff"] });
    expect(!result.ok && result.error.kind).toBe("forbidden");
    expect(writes).toEqual([]);
  });

  it("refuses bad input before opening a transaction", async () => {
    const { voidPayment, writes } = setup();
    const result = await voidPayment({ paymentId: "nope", reason: "" }, CTX);
    expect(!result.ok && result.error.kind).toBe("validation");
    expect(writes).toEqual([]);
  });

  it("says not found when the payment is missing", async () => {
    const { voidPayment, writes } = setup({ payments: [null] });
    const result = await voidPayment(payment, CTX);
    expect(!result.ok && result.error.kind).toBe("not_found");
    expect(writes).toEqual([]);
  });

  it("says already void when the payment was void before the lock", async () => {
    const { voidPayment, writes } = setup({ payments: [{ ...PAYMENT, isVoid: true }] });
    const result = await voidPayment(payment, CTX);
    expect(!result.ok && result.error.kind).toBe("conflict");
    expect(writes).toEqual([]);
  });

  it("says already void when the update finds nothing to void", async () => {
    const { voidPayment, writes } = setup({ changes: false });
    const result = await voidPayment(payment, CTX);
    expect(!result.ok && result.error.kind).toBe("conflict");
    expect(writes).toEqual(["void-payment"]);
  });

  it("voids, reports the reversed allocations and writes the audit event", async () => {
    const { voidPayment, writes } = setup();
    const result = await voidPayment(payment, CTX);
    expect(result).toEqual({
      ok: true,
      value: {
        id: PAYMENT_ID,
        memberId: MEMBER_ID,
        amount: 7000,
        reason: "wrong member",
        reversed: PAYMENT.allocations,
        reallocated: [],
      },
    });
    expect(writes).toEqual(["void-payment", "audit"]);
  });

  it("throws when the member of the payment cannot be read, since that is a bug", async () => {
    await expect(setup({ member: null }).voidPayment(payment, CTX)).rejects.toThrow("member");
  });

  it("throws when the payment vanishes under the member lock, since that is a bug", async () => {
    await expect(setup({ payments: [PAYMENT, null] }).voidPayment(payment, CTX)).rejects.toThrow(
      "disappeared",
    );
  });
});

describe("makeVoidInvoice with the rows it reads faked", () => {
  it("names the permission it needs", () => {
    expect(setup().voidInvoice.requiredPermission).toBe("invoice.void");
  });

  it("writes nothing for a caller who may not void", async () => {
    const { voidInvoice, writes } = setup();
    const result = await voidInvoice(invoice, { ...CTX, roles: ["member"] });
    expect(!result.ok && result.error.kind).toBe("forbidden");
    expect(writes).toEqual([]);
  });

  it("refuses bad input", async () => {
    const result = await setup().voidInvoice({ invoiceId: "nope", reason: "x" }, CTX);
    expect(!result.ok && result.error.kind).toBe("validation");
  });

  it("says not found when the invoice is missing", async () => {
    const result = await setup({ invoices: [null] }).voidInvoice(invoice, CTX);
    expect(!result.ok && result.error.kind).toBe("not_found");
  });

  it("says already void when the invoice was void before the lock", async () => {
    const { voidInvoice, writes } = setup({ invoices: [{ ...INVOICE, isVoid: true }] });
    const result = await voidInvoice(invoice, CTX);
    expect(!result.ok && result.error.kind).toBe("conflict");
    expect(writes).toEqual([]);
  });

  it("refuses an invoice that has counted allocations", async () => {
    const { voidInvoice, writes } = setup({ invoices: [{ ...INVOICE, counted: 100 }] });
    const result = await voidInvoice(invoice, CTX);
    expect(!result.ok && result.error.kind).toBe("conflict");
    expect(writes).toEqual([]);
  });

  it("says already void when the update finds nothing to void", async () => {
    const { voidInvoice, writes } = setup({ changes: false });
    const result = await voidInvoice(invoice, CTX);
    expect(!result.ok && result.error.kind).toBe("conflict");
    expect(writes).toEqual(["void-invoice"]);
  });

  it("voids and writes the audit event", async () => {
    const { voidInvoice, writes } = setup();
    const result = await voidInvoice(invoice, CTX);
    expect(result).toEqual({
      ok: true,
      value: { id: INVOICE_ID, memberId: MEMBER_ID, reason: "billed twice" },
    });
    expect(writes).toEqual(["void-invoice", "audit"]);
  });

  it("throws when the member of the invoice cannot be read, since that is a bug", async () => {
    await expect(setup({ member: null }).voidInvoice(invoice, CTX)).rejects.toThrow("member");
  });

  it("throws when the invoice vanishes under the member lock, since that is a bug", async () => {
    await expect(setup({ invoices: [INVOICE, null] }).voidInvoice(invoice, CTX)).rejects.toThrow(
      "disappeared",
    );
  });
});
