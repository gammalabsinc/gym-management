import { describe, expect, it } from "vitest";
import type { Discount } from "./discounts";
import {
  buildInvoice,
  type CyclesToGenerate,
  cyclesToGenerate,
  MAX_AHEAD_CYCLES,
} from "./invoice-build";

const BASE: CyclesToGenerate = {
  billingDay: 15,
  activeFrom: "2026-11-15",
  lastPeriodEnd: null,
  today: "2026-11-16",
  ahead: 0,
};

function starts(input: Partial<CyclesToGenerate>): string[] {
  const result = cyclesToGenerate({ ...BASE, ...input });
  if (!result.ok) throw new Error(result.error.message);
  return result.value.map((cycle) => cycle.start);
}

describe("cyclesToGenerate", () => {
  it("builds the first cycle of a new member", () => {
    const result = cyclesToGenerate(BASE);
    expect(result).toEqual({ ok: true, value: [{ start: "2026-11-15", end: "2026-12-14" }] });
  });

  it("builds the cycles ahead of the one that holds today", () => {
    expect(starts({ ahead: 2 })).toEqual(["2026-11-15", "2026-12-15", "2027-01-15"]);
    expect(starts({ ahead: MAX_AHEAD_CYCLES })).toHaveLength(MAX_AHEAD_CYCLES + 1);
  });

  it("builds every cycle from the join date up to today", () => {
    expect(starts({ activeFrom: "2026-08-15" })).toEqual([
      "2026-08-15",
      "2026-09-15",
      "2026-10-15",
      "2026-11-15",
    ]);
  });

  it("continues after the latest invoice and builds nothing when it is already built", () => {
    expect(starts({ lastPeriodEnd: "2026-12-14", ahead: 1 })).toEqual(["2026-12-15"]);
    expect(starts({ lastPeriodEnd: "2026-12-14", ahead: 0 })).toEqual([]);
  });

  it("skips a cycle that began before the first day still to bill", () => {
    // The billing day moved from 15 to 20 after an invoice that ended on 14 December.
    expect(
      starts({ billingDay: 20, lastPeriodEnd: "2026-12-14", today: "2026-12-16", ahead: 1 }),
    ).toEqual(["2026-12-20"]);
  });

  it("starts the first invoice at the cycle that holds the join day, even when it began earlier", () => {
    expect(starts({ billingDay: 1, activeFrom: "2026-11-15" })).toEqual(["2026-11-01"]);
  });

  it("never bills the cycles a member spent away, once they are back", () => {
    // The last invoice ended on 14 September. The member came back on 1 November.
    expect(starts({ lastPeriodEnd: "2026-09-14", activeFrom: "2026-11-01" })).toEqual([
      "2026-11-15",
    ]);
  });

  it("refuses a number of cycles ahead outside 0 to 12", () => {
    for (const ahead of [-1, 1.5, MAX_AHEAD_CYCLES + 1, Number.NaN]) {
      const result = cyclesToGenerate({ ...BASE, ahead });
      expect(result.ok).toBe(false);
    }
  });

  it("refuses dates and a billing day that are not real", () => {
    expect(cyclesToGenerate({ ...BASE, lastPeriodEnd: "2026-02-30" }).ok).toBe(false);
    expect(cyclesToGenerate({ ...BASE, today: "not a date" }).ok).toBe(false);
    expect(cyclesToGenerate({ ...BASE, activeFrom: "not a date" }).ok).toBe(false);
    expect(cyclesToGenerate({ ...BASE, billingDay: 0 }).ok).toBe(false);
  });
});

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

const CYCLE = { start: "2026-11-15", end: "2026-12-14" };
const FEES = { monthlyFee: 5000, admissionFee: 2000 };

function build(overrides: Partial<Parameters<typeof buildInvoice>[0]> = {}) {
  const result = buildInvoice({
    cycle: CYCLE,
    ...FEES,
    isFirst: false,
    discounts: [],
    ...overrides,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("buildInvoice", () => {
  it("builds the first invoice with the admission line and a recurring discount", () => {
    const invoice = build({ isFirst: true, discounts: [discount()] });
    expect(invoice.lines.map((line) => [line.lineType, line.amount])).toEqual([
      ["membership", 5000],
      ["admission", 2000],
      ["discount", -1000],
    ]);
    expect(invoice.total).toBe(6000);
    expect(invoice.dueDate).toBe(CYCLE.start);
    expect([invoice.periodStart, invoice.periodEnd]).toEqual([CYCLE.start, CYCLE.end]);
    expect(invoice.consumedDiscountIds).toEqual([]);
  });

  it("leaves the admission line off every later invoice", () => {
    const invoice = build({ discounts: [discount()] });
    expect(invoice.lines.map((line) => line.lineType)).toEqual(["membership", "discount"]);
    expect(invoice.total).toBe(4000);
  });

  it("leaves the admission line off when the fee is zero", () => {
    const invoice = build({ isFirst: true, admissionFee: 0 });
    expect(invoice.lines.map((line) => line.lineType)).toEqual(["membership"]);
    expect(invoice.total).toBe(5000);
  });

  it("reports the one time discounts that landed, and ties each discount line to its row", () => {
    const invoice = build({
      discounts: [discount({ id: "once", isRecurring: false }), discount({ id: "always" })],
    });
    expect(invoice.consumedDiscountIds).toEqual(["once"]);
    expect(
      invoice.lines.flatMap((line) => (line.discountId === null ? [] : [line.discountId])),
    ).toEqual(["always", "once"]);
  });

  it("caps discounts at the membership line and never touches the admission fee", () => {
    const invoice = build({ isFirst: true, discounts: [discount({ amount: 9000 })] });
    expect(invoice.total).toBe(2000);
  });

  it("builds a zero invoice when the discounts cover the fee on a later cycle", () => {
    expect(build({ discounts: [discount({ amount: 5000 })] }).total).toBe(0);
  });

  it("refuses a fee that is not whole minor units, and a negative fee", () => {
    for (const fees of [{ monthlyFee: -1 }, { monthlyFee: 1.5 }, { admissionFee: -1 }]) {
      const result = buildInvoice({
        cycle: CYCLE,
        ...FEES,
        ...fees,
        isFirst: true,
        discounts: [],
      });
      expect(result.ok).toBe(false);
    }
  });

  it("passes on a discount the cap rules refuse", () => {
    const result = buildInvoice({
      cycle: CYCLE,
      ...FEES,
      isFirst: false,
      discounts: [discount({ amount: 0 })],
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a total that is not a safe integer", () => {
    const result = buildInvoice({
      cycle: CYCLE,
      monthlyFee: Number.MAX_SAFE_INTEGER,
      admissionFee: 5,
      isFirst: true,
      discounts: [],
    });
    expect(result.ok).toBe(false);
  });
});
