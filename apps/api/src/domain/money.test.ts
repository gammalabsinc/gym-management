import { describe, expect, it } from "vitest";
import { addMinor, isMinorUnits, minorUnits, subtractMinor, sumMinor } from "./money";

describe("isMinorUnits", () => {
  it("accepts whole numbers, negative ones included", () => {
    expect(isMinorUnits(0)).toBe(true);
    expect(isMinorUnits(12_345)).toBe(true);
    expect(isMinorUnits(-500)).toBe(true);
  });

  it("rejects floats, non finite numbers, unsafe integers and non numbers", () => {
    for (const value of [0.5, 1.25, Number.NaN, Infinity, 2 ** 53, "100", null, undefined]) {
      expect(isMinorUnits(value)).toBe(false);
    }
  });
});

describe("minorUnits", () => {
  it("returns a valid amount unchanged", () => {
    expect(minorUnits(2500)).toEqual({ ok: true, value: 2500 });
  });

  it("names the field in the validation error", () => {
    const result = minorUnits(10.5, "fee");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect(result.error.issues[0]?.path).toEqual(["fee"]);
    }
  });

  it("defaults the field name to amount", () => {
    const result = minorUnits("5");
    expect(!result.ok && result.error.issues[0]?.path).toEqual(["amount"]);
  });
});

describe("addMinor and subtractMinor", () => {
  it("adds and subtracts exactly, where float maths would drift", () => {
    expect(addMinor(10, 20)).toEqual({ ok: true, value: 30 });
    expect(subtractMinor(30, 45)).toEqual({ ok: true, value: -15 });
  });

  it("fails instead of overflowing past the safe integer range", () => {
    expect(addMinor(Number.MAX_SAFE_INTEGER, 1).ok).toBe(false);
    expect(subtractMinor(-Number.MAX_SAFE_INTEGER, 1).ok).toBe(false);
  });

  it("fails when an operand is not minor units", () => {
    expect(addMinor(0.1, 0.2).ok).toBe(false);
  });
});

describe("sumMinor", () => {
  it("sums a list, and an empty list is zero", () => {
    expect(sumMinor([])).toEqual({ ok: true, value: 0 });
    expect(sumMinor([5000, 1000, -1500])).toEqual({ ok: true, value: 4500 });
  });

  it("stops at the first invalid value", () => {
    expect(sumMinor([1, 2.5, 3]).ok).toBe(false);
    expect(sumMinor([Number.MAX_SAFE_INTEGER, 1, -1]).ok).toBe(false);
  });
});
