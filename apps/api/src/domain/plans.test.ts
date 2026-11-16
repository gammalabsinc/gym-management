import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAN_KEY,
  DEFAULT_PLAN_NAME,
  ensureAssignable,
  MAX_FEE,
  MAX_PLAN_NAME_LENGTH,
  type Plan,
  parseDefaultPlan,
} from "./plans";

const PLAN: Plan = {
  id: "p1",
  key: "default",
  name: "Default",
  admissionFee: 2000,
  monthlyFee: 5000,
  isActive: true,
};

describe("parseDefaultPlan", () => {
  it("uses the default key, and the default name when none is given", () => {
    expect(parseDefaultPlan({ admissionFee: 2000, monthlyFee: 5000 })).toEqual({
      ok: true,
      value: {
        key: DEFAULT_PLAN_KEY,
        name: DEFAULT_PLAN_NAME,
        admissionFee: 2000,
        monthlyFee: 5000,
      },
    });
  });

  it("trims a given name and treats a blank one as none", () => {
    const named = parseDefaultPlan({ admissionFee: 0, monthlyFee: 0, name: "  Standard " });
    const blank = parseDefaultPlan({ admissionFee: 0, monthlyFee: MAX_FEE, name: "   " });
    expect(named.ok && named.value.name).toBe("Standard");
    expect(blank.ok && blank.value.name).toBe(DEFAULT_PLAN_NAME);
  });

  it("rejects fees that are negative, fractional, unsafe or too large for the column", () => {
    for (const fee of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_FEE + 1]) {
      expect(parseDefaultPlan({ admissionFee: fee, monthlyFee: 100 }).ok).toBe(false);
      expect(parseDefaultPlan({ admissionFee: 100, monthlyFee: fee }).ok).toBe(false);
    }
  });

  it("reports every problem at once", () => {
    const result = parseDefaultPlan({
      admissionFee: -1,
      monthlyFee: 1.5,
      name: "n".repeat(MAX_PLAN_NAME_LENGTH + 1),
    });
    expect(!result.ok && result.error.issues.map((issue) => issue.path[0])).toEqual([
      "admissionFee",
      "monthlyFee",
      "name",
    ]);
  });
});

describe("ensureAssignable", () => {
  it("lets an active plan be assigned", () => {
    expect(ensureAssignable(PLAN)).toEqual({ ok: true, value: PLAN });
  });

  it("refuses an archived plan", () => {
    expect(ensureAssignable({ ...PLAN, isActive: false })).toEqual({
      ok: false,
      error: { kind: "conflict", message: "This plan is archived" },
    });
  });
});
