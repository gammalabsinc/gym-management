import { describe, expect, it } from "vitest";
import { formatMoneyInput, parseMoneyInput, parseWholeNumber } from "./money-input";

describe("parseMoneyInput", () => {
  it("converts to minor units without floats", () => {
    expect(parseMoneyInput("50", "USD")).toEqual({ ok: true, minor: 5000 });
    expect(parseMoneyInput("50.5", "USD")).toEqual({ ok: true, minor: 5050 });
    expect(parseMoneyInput("50.05", "USD")).toEqual({ ok: true, minor: 5005 });
    expect(parseMoneyInput("0.1", "USD")).toEqual({ ok: true, minor: 10 });
    expect(parseMoneyInput("19.99", "USD")).toEqual({ ok: true, minor: 1999 });
    expect(parseMoneyInput("$1,050.00", "USD")).toEqual({ ok: true, minor: 105000 });
    expect(parseMoneyInput("  8. ", "USD")).toEqual({ ok: true, minor: 800 });
    expect(parseMoneyInput("007", "USD")).toEqual({ ok: true, minor: 700 });
  });

  it("rejects more than two decimal places, junk and empty", () => {
    expect(parseMoneyInput("1.234", "USD")).toEqual({
      ok: false,
      error: "Use at most 2 decimal places.",
    });
    for (const text of ["", "abc", "1.2.3", "-5", ".5", "5 0"]) {
      expect(parseMoneyInput(text, "USD").ok).toBe(false);
    }
  });

  it("follows the currency's decimal places", () => {
    expect(parseMoneyInput("500", "JPY")).toEqual({ ok: true, minor: 500 });
    expect(parseMoneyInput("5.5", "JPY")).toEqual({ ok: false, error: "Enter a whole amount." });
    expect(parseMoneyInput("1.234", "KWD")).toEqual({ ok: true, minor: 1234 });
  });

  it("rejects an amount that is too large", () => {
    expect(parseMoneyInput("1234567890", "USD").ok).toBe(false);
    expect(parseMoneyInput("123456789", "USD").ok).toBe(true);
  });
});

describe("formatMoneyInput", () => {
  it("shows plain decimals", () => {
    expect(formatMoneyInput(5000, "USD")).toBe("50.00");
    expect(formatMoneyInput(5, "USD")).toBe("0.05");
    expect(formatMoneyInput(0, "USD")).toBe("0.00");
    expect(formatMoneyInput(500, "JPY")).toBe("500");
    expect(formatMoneyInput(1234, "KWD")).toBe("1.234");
  });
});

describe("parseWholeNumber", () => {
  it("accepts whole numbers up to the limit", () => {
    expect(parseWholeNumber(" 5 ", 365)).toEqual({ ok: true, minor: 5 });
    expect(parseWholeNumber("365", 365)).toEqual({ ok: true, minor: 365 });
  });
  it("rejects the rest", () => {
    expect(parseWholeNumber("366", 365)).toEqual({ ok: false, error: "Enter 365 or less." });
    for (const text of ["", "x", "1.5", "-1", "123456"])
      expect(parseWholeNumber(text, 365).ok).toBe(false);
  });
});
