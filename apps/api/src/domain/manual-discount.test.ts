import { describe, expect, it } from "vitest";
import {
  ALREADY_ENDED_MESSAGE,
  endDateFor,
  MAX_DISCOUNT_AMOUNT,
  NOT_STARTED_MESSAGE,
  ONE_TIME_MESSAGE,
  parseEndDiscount,
  parseManualDiscount,
} from "./manual-discount";

const MEMBER = "11111111-1111-4111-8111-111111111111";
const GOOD = { memberId: MEMBER, amount: 500, isRecurring: true, reason: "  Loyal member  " };

describe("parseManualDiscount", () => {
  it("accepts a discount and trims the reason", () => {
    expect(parseManualDiscount(GOOD)).toEqual({
      ok: true,
      value: { memberId: MEMBER, amount: 500, isRecurring: true, reason: "Loyal member" },
    });
  });

  it("accepts the smallest and the largest amount", () => {
    expect(parseManualDiscount({ ...GOOD, amount: 1 }).ok).toBe(true);
    expect(parseManualDiscount({ ...GOOD, amount: MAX_DISCOUNT_AMOUNT }).ok).toBe(true);
  });

  it.each([0, -5, 1.5, Number.NaN, MAX_DISCOUNT_AMOUNT + 1, Number.MAX_SAFE_INTEGER + 2])(
    "refuses the amount %s",
    (amount) => {
      const result = parseManualDiscount({ ...GOOD, amount });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.issues.map((i) => i.path)).toEqual([["amount"]]);
    },
  );

  it("refuses a missing reason and a cadence that is not a boolean", () => {
    const result = parseManualDiscount({
      ...GOOD,
      reason: "   ",
      isRecurring: "monthly" as unknown as boolean,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.issues.map((i) => i.path[0])).toEqual(["isRecurring", "reason"]);
  });

  it("reports every problem at once, including a bad member id", () => {
    const result = parseManualDiscount({ memberId: "x", amount: 0, isRecurring: true, reason: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.map((i) => i.path[0])).toEqual(["memberId", "amount", "reason"]);
    }
  });
});

describe("parseEndDiscount", () => {
  it("returns the id, lower case", () => {
    expect(parseEndDiscount({ discountId: MEMBER.toUpperCase() })).toEqual({
      ok: true,
      value: MEMBER,
    });
  });

  it("refuses a bad id", () => {
    const result = parseEndDiscount({ discountId: "nope" });
    expect(result).toMatchObject({ ok: false, error: { kind: "validation" } });
  });
});

describe("endDateFor", () => {
  const live = {
    isRecurring: true,
    startsOn: "2026-10-01",
    endsOn: null,
    isActive: true,
    consumedInvoiceId: null,
  };

  it("ends an open monthly discount today", () => {
    expect(endDateFor(live, "2026-11-17")).toEqual({ ok: true, value: "2026-11-17" });
  });

  it("ends a discount that was set to end later, and one that started today", () => {
    expect(endDateFor({ ...live, endsOn: "2026-12-31" }, "2026-11-17")).toEqual({
      ok: true,
      value: "2026-11-17",
    });
    expect(endDateFor({ ...live, startsOn: "2026-11-17" }, "2026-11-17").ok).toBe(true);
  });

  it("refuses a one time discount", () => {
    expect(endDateFor({ ...live, isRecurring: false }, "2026-11-17")).toMatchObject({
      ok: false,
      error: { kind: "conflict", message: ONE_TIME_MESSAGE },
    });
  });

  it.each([
    ["switched off", { ...live, isActive: false }],
    ["past its end date", { ...live, endsOn: "2026-11-16" }],
  ])("refuses a discount that is %s", (_name, discount) => {
    expect(endDateFor(discount, "2026-11-17")).toMatchObject({
      ok: false,
      error: { kind: "conflict", message: ALREADY_ENDED_MESSAGE },
    });
  });

  it("refuses a discount that has not started yet", () => {
    expect(endDateFor({ ...live, startsOn: "2026-11-18" }, "2026-11-17")).toMatchObject({
      ok: false,
      error: { kind: "conflict", message: NOT_STARTED_MESSAGE },
    });
  });
});
