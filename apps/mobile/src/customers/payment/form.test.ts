import { describe, expect, it } from "vitest";
import {
  AMOUNT_ZERO,
  checkAmount,
  checkDate,
  DATE_FUTURE,
  DATE_INVALID,
  isCalendarDate,
  LINK_INVALID,
  todayIn,
  validatePayment,
} from "./form";

describe("dates", () => {
  it("accepts real dates only", () => {
    expect(isCalendarDate("2026-11-26")).toBe(true);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("26-11-26")).toBe(false);
  });

  it("uses the gym's time zone for today", () => {
    const instant = new Date("2026-11-26T23:30:00Z");
    expect(todayIn("UTC", instant)).toBe("2026-11-26");
    expect(todayIn("Asia/Tokyo", instant)).toBe("2026-11-27");
  });

  it("refuses a future date and a made up one, and allows today and the past", () => {
    expect(checkDate("2026-11-26", "2026-11-26")).toBeNull();
    expect(checkDate("2026-01-01", "2026-11-26")).toBeNull();
    expect(checkDate("2026-11-27", "2026-11-26")).toBe(DATE_FUTURE);
    expect(checkDate("2026-02-30", "2026-11-26")).toBe(DATE_INVALID);
  });
});

describe("checkAmount", () => {
  it("parses to integer minor units with no float maths", () => {
    expect(checkAmount("50.00", "USD")).toEqual({ ok: true, minor: 5000 });
    expect(checkAmount("0.07", "USD")).toEqual({ ok: true, minor: 7 });
    expect(checkAmount("1,234.5", "USD")).toEqual({ ok: true, minor: 123450 });
  });

  it("rejects more than two decimals, zero and nonsense", () => {
    expect(checkAmount("10.001", "USD")).toEqual({
      ok: false,
      error: "Use at most 2 decimal places.",
    });
    expect(checkAmount("0", "USD")).toEqual({ ok: false, error: AMOUNT_ZERO });
    expect(checkAmount("0.00", "USD")).toEqual({ ok: false, error: AMOUNT_ZERO });
    expect(checkAmount("abc", "USD").ok).toBe(false);
    expect(checkAmount("", "USD").ok).toBe(false);
    expect(checkAmount("-5", "USD").ok).toBe(false);
  });
});

describe("validatePayment", () => {
  const draft = { amount: "30.00", method: "CARD" as const, paidOn: "2026-11-25", proofLink: "" };

  it("returns the value, with a blank proof link left out", () => {
    expect(validatePayment(draft, "USD", "2026-11-26")).toEqual({
      ok: true,
      value: { amount: 3000, method: "CARD", paidOn: "2026-11-25", proofLink: null },
    });
  });

  it("keeps a proof link that starts with http or https", () => {
    const result = validatePayment(
      { ...draft, proofLink: " https://x.test/p " },
      "USD",
      "2026-11-26",
    );
    expect(result).toMatchObject({ ok: true, value: { proofLink: "https://x.test/p" } });
  });

  it("reports every problem together", () => {
    expect(
      validatePayment(
        { amount: "1.234", method: "CASH", paidOn: "2026-11-30", proofLink: "ftp://x" },
        "USD",
        "2026-11-26",
      ),
    ).toEqual({
      ok: false,
      errors: {
        amount: "Use at most 2 decimal places.",
        paidOn: DATE_FUTURE,
        proofLink: LINK_INVALID,
      },
    });
  });
});
