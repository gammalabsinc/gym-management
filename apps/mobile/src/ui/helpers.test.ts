import { describe, expect, it } from "vitest";
import { luminance, safeBrand, textOn } from "./contrast";
import { formatDate, formatDateTime, initials } from "./dates";
import { currencyExponent, formatMoney } from "./money";
import { DEFAULT_BRAND, MIN_TOUCH } from "./tokens";

describe("textOn", () => {
  it("picks white on dark and black on light brand colours", () => {
    expect(textOn("#0B3D2E")).toBe("#FFFFFF");
    expect(textOn("#7C3AED")).toBe("#FFFFFF");
    expect(textOn("#FFD400")).toBe("#000000");
    expect(textOn("#FFFFFF")).toBe("#000000");
    expect(textOn("#000000")).toBe("#FFFFFF");
  });

  it("always reaches at least 4.5 to 1 against the chosen text for the preset brands", () => {
    for (const brand of ["#2563EB", "#0B3D2E", "#7C3AED", "#FFD400"]) {
      const text = textOn(brand);
      const a = luminance(brand) + 0.05;
      const b = luminance(text) + 0.05;
      expect(Math.max(a, b) / Math.min(a, b)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("safeBrand", () => {
  it("keeps a six digit hex and falls back otherwise", () => {
    expect(safeBrand("#0b3d2e")).toBe("#0b3d2e");
    for (const bad of ["red", "#fff", "#12345G", "", null, undefined]) {
      expect(safeBrand(bad)).toBe(DEFAULT_BRAND);
    }
  });
});

describe("formatMoney", () => {
  it("formats integer minor units without float maths", () => {
    expect(formatMoney(7000, "USD")).toBe("$70.00");
    expect(formatMoney(5, "USD")).toBe("$0.05");
    expect(formatMoney(0, "USD")).toBe("$0.00");
    expect(formatMoney(123456789, "EUR")).toBe("€1,234,567.89");
    expect(formatMoney(-250, "GBP")).toBe("-£2.50");
  });

  it("uses the currency's number of decimals", () => {
    expect(formatMoney(1500, "JPY")).toBe("¥1,500");
    expect(formatMoney(1500, "KWD")).toBe("KWD 1.500");
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
  });

  it("keeps amounts that a float would lose", () => {
    expect(formatMoney(9007199254740991, "USD")).toBe("$90,071,992,547,409.91");
  });

  it("rejects fractions and unsafe integers", () => {
    expect(() => formatMoney(10.5, "USD")).toThrow(RangeError);
    expect(() => formatMoney(Number.NaN, "USD")).toThrow(RangeError);
    expect(() => formatMoney(2 ** 60, "USD")).toThrow(RangeError);
  });
});

describe("dates", () => {
  it("formats a calendar date with no time zone shift", () => {
    expect(formatDate("2026-12-13")).toBe("Dec 13, 2026");
    expect(formatDate("2026-01-05")).toBe("Jan 5, 2026");
  });

  it("rejects values that are not dates", () => {
    expect(() => formatDate("13/12/2026")).toThrow(RangeError);
    expect(() => formatDate("2026-13-01")).toThrow(RangeError);
  });

  it("formats an instant in the gym's time zone", () => {
    expect(formatDateTime("2026-10-02T23:30:00Z", "UTC")).toBe("Oct 2, 2026, 11:30 PM");
    expect(formatDateTime("2026-10-02T23:30:00Z", "Asia/Karachi")).toBe("Oct 3, 2026, 4:30 AM");
  });

  it("rejects an instant it cannot parse", () => {
    expect(() => formatDateTime("later", "UTC")).toThrow(RangeError);
  });
});

describe("initials", () => {
  it("uses the first and last word of the name", () => {
    expect(initials("Ayesha Khan")).toBe("AK");
    expect(initials("  mary jane  watson ")).toBe("MW");
    expect(initials("Sam")).toBe("SA");
  });

  it("falls back to the email, then a question mark", () => {
    expect(initials(null, "zed@example.test")).toBe("ZE");
    expect(initials("  ")).toBe("?");
    expect(initials(undefined)).toBe("?");
  });
});

describe("tokens", () => {
  it("sets the touch target to 44 points", () => {
    expect(MIN_TOUCH).toBe(44);
  });
});
