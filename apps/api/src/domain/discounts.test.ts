import { describe, expect, it } from "vitest";
import { applyDiscounts, type Discount, type DiscountOutcome } from "./discounts";

function discount(overrides: Partial<Discount> & { id: string; amount: number }): Discount {
  return {
    isRecurring: true,
    startsOn: "2026-01-01",
    endsOn: null,
    isActive: true,
    consumedInvoiceId: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function run(fee: number, discounts: Discount[], periodStart = "2026-03-01"): DiscountOutcome {
  const result = applyDiscounts({ membershipFee: fee, periodStart, discounts });
  if (!result.ok) throw new Error(`unexpected failure: ${result.error.message}`);
  return result.value;
}

describe("applyDiscounts", () => {
  it("returns no lines and a zero total when there are no discounts", () => {
    expect(run(5000, [])).toEqual({ lines: [], total: 0 });
  });

  it("applies the worked example: a 1000 recurring referral on a 5000 fee", () => {
    const outcome = run(5000, [discount({ id: "a", amount: 1000 })]);
    expect(outcome.lines).toEqual([{ discountId: "a", amount: -1000, consumes: false }]);
    expect(outcome.total).toBe(-1000);
  });

  it("applies a recurring discount every cycle and never consumes it", () => {
    const spent = discount({ id: "a", amount: 500, consumedInvoiceId: "inv-1" });
    expect(run(5000, [spent]).lines).toEqual([{ discountId: "a", amount: -500, consumes: false }]);
  });

  it("applies a one time discount once and marks it consumed", () => {
    const outcome = run(5000, [discount({ id: "a", amount: 700, isRecurring: false })]);
    expect(outcome.lines).toEqual([{ discountId: "a", amount: -700, consumes: true }]);
  });

  it("skips a one time discount that was already consumed", () => {
    const spent = discount({
      id: "a",
      amount: 700,
      isRecurring: false,
      consumedInvoiceId: "inv-1",
    });
    expect(run(5000, [spent])).toEqual({ lines: [], total: 0 });
  });

  it("applies oldest first, using the id to break a tie", () => {
    const outcome = run(5000, [
      discount({ id: "c", amount: 100, createdAt: "2026-02-01T00:00:00Z" }),
      discount({ id: "b", amount: 200, createdAt: "2026-01-15T00:00:00Z" }),
      discount({ id: "a", amount: 300, createdAt: "2026-01-15T00:00:00Z" }),
    ]);
    expect(outcome.lines.map((line) => line.discountId)).toEqual(["a", "b", "c"]);
  });

  it("keeps the given order for two identical rows", () => {
    const twin = discount({ id: "a", amount: 100 });
    const outcome = run(5000, [twin, twin]);
    expect(outcome.lines).toHaveLength(2);
    expect(outcome.total).toBe(-200);
  });

  it("does not reorder or change the caller's list", () => {
    const list = [
      discount({ id: "b", amount: 100, createdAt: "2026-02-01T00:00:00Z" }),
      discount({ id: "a", amount: 100, createdAt: "2026-01-01T00:00:00Z" }),
    ];
    run(5000, list);
    expect(list.map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  it("caps stacked discounts at the membership fee, so the line never goes below zero", () => {
    const outcome = run(5000, [
      discount({ id: "a", amount: 3000, createdAt: "2026-01-01T00:00:00Z" }),
      discount({ id: "b", amount: 3000, createdAt: "2026-01-02T00:00:00Z" }),
      discount({ id: "c", amount: 3000, createdAt: "2026-01-03T00:00:00Z" }),
    ]);
    expect(outcome.lines).toEqual([
      { discountId: "a", amount: -3000, consumes: false },
      { discountId: "b", amount: -2000, consumes: false },
    ]);
    expect(outcome.total).toBe(-5000);
  });

  it("counts a one time discount cut short by the cap as consumed, and loses the unused part", () => {
    const outcome = run(1000, [discount({ id: "a", amount: 2500, isRecurring: false })]);
    expect(outcome.lines).toEqual([{ discountId: "a", amount: -1000, consumes: true }]);
  });

  it("leaves a one time discount unspent when the fee is already at zero before it", () => {
    const outcome = run(1000, [
      discount({ id: "a", amount: 1000, createdAt: "2026-01-01T00:00:00Z" }),
      discount({ id: "b", amount: 400, isRecurring: false, createdAt: "2026-01-02T00:00:00Z" }),
    ]);
    expect(outcome.lines.map((line) => line.discountId)).toEqual(["a"]);
  });

  it("applies nothing against a zero fee", () => {
    expect(run(0, [discount({ id: "a", amount: 500, isRecurring: false })])).toEqual({
      lines: [],
      total: 0,
    });
  });

  it("only uses discounts that are active and cover the period start", () => {
    const outcome = run(
      5000,
      [
        discount({ id: "inactive", amount: 100, isActive: false }),
        discount({ id: "future", amount: 100, startsOn: "2026-03-02" }),
        discount({ id: "ended", amount: 100, endsOn: "2026-02-28" }),
        discount({ id: "starts-today", amount: 100, startsOn: "2026-03-01" }),
        discount({ id: "ends-today", amount: 100, endsOn: "2026-03-01" }),
        discount({ id: "open", amount: 100, endsOn: null }),
      ],
      "2026-03-01",
    );
    expect(outcome.lines.map((line) => line.discountId).sort()).toEqual([
      "ends-today",
      "open",
      "starts-today",
    ]);
  });

  it("never lets total discounts exceed the fee, for many fee and stack sizes", () => {
    for (let fee = 0; fee <= 3000; fee += 250) {
      for (let count = 0; count <= 6; count++) {
        const stack = Array.from({ length: count }, (_, index) =>
          discount({
            id: `d${index}`,
            amount: 100 + index * 333,
            isRecurring: index % 2 === 0,
            createdAt: `2026-01-0${index + 1}T00:00:00Z`,
          }),
        );
        const outcome = run(fee, stack);
        expect(Math.abs(outcome.total)).toBeLessThanOrEqual(fee);
        expect(outcome.lines.every((line) => line.amount < 0)).toBe(true);
        const requested = stack.reduce((sum, entry) => sum + entry.amount, 0);
        expect(Math.abs(outcome.total)).toBe(Math.min(fee, requested));
      }
    }
  });
});

describe("applyDiscounts validation", () => {
  const good = discount({ id: "a", amount: 100 });

  function issuePaths(input: Parameters<typeof applyDiscounts>[0]): unknown[] {
    const result = applyDiscounts(input);
    if (result.ok) throw new Error("expected a validation error");
    expect(result.error.kind).toBe("validation");
    return result.error.issues.map((entry) => entry.path);
  }

  it("rejects a negative or fractional fee and a bad period start", () => {
    expect(issuePaths({ membershipFee: -1, periodStart: "2026-03-01", discounts: [] })).toEqual([
      ["membershipFee"],
    ]);
    expect(issuePaths({ membershipFee: 10.5, periodStart: "2026-03-01", discounts: [] })).toEqual([
      ["membershipFee"],
    ]);
    expect(issuePaths({ membershipFee: 100, periodStart: "2026-02-30", discounts: [] })).toEqual([
      ["periodStart"],
    ]);
  });

  it("rejects a discount with a zero, negative or fractional amount", () => {
    for (const amount of [0, -5, 2.5]) {
      expect(
        issuePaths({
          membershipFee: 100,
          periodStart: "2026-03-01",
          discounts: [good, discount({ id: "b", amount })],
        }),
      ).toEqual([["discounts", 1, "amount"]]);
    }
  });

  it("rejects bad discount dates, and reports every problem together", () => {
    expect(
      issuePaths({
        membershipFee: -1,
        periodStart: "nope",
        discounts: [discount({ id: "b", amount: 1, startsOn: "x", endsOn: "2026-13-01" })],
      }),
    ).toEqual([
      ["membershipFee"],
      ["periodStart"],
      ["discounts", 0, "startsOn"],
      ["discounts", 0, "endsOn"],
    ]);
  });
});
