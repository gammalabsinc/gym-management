import { describe, expect, it } from "vitest";
import {
  type BackfillMemberInput,
  MAX_BACKFILL_MEMBERS,
  parseBackfill,
  parseBackfillMember,
} from "./backfill";

const TODAY = "2026-11-17";

const base: BackfillMemberInput = {
  email: "Ada@X.test",
  fullName: "Ada",
  joinDate: "2026-01-05",
  statusHistory: [],
  payments: [],
  discounts: [],
};

function issuesOf(input: BackfillMemberInput): string[] {
  const result = parseBackfillMember(input, TODAY);
  return result.ok ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

describe("parseBackfillMember", () => {
  it("normalizes a valid member and takes the billing day from the join date", () => {
    const result = parseBackfillMember(base, TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toMatchObject({ email: "ada@x.test", billingDay: 5 });
  });

  it("keeps an explicit billing day and rejects a bad one", () => {
    const ok = parseBackfillMember({ ...base, billingDay: 20 }, TODAY);
    expect(ok.ok && ok.value.billingDay).toBe(20);
    expect(issuesOf({ ...base, billingDay: 40 })).toEqual([
      "billingDay: Must be a whole number from 1 to 31",
    ]);
  });

  it("reports an unknown status", () => {
    const issues = issuesOf({
      ...base,
      statusHistory: [{ status: "frozen", from: "2026-03-01", reason: "x" }],
    });
    expect(issues.some((i) => i.startsWith("statusHistory.0.status"))).toBe(true);
  });

  it("requires a reason for a manual discount and a source for a referral", () => {
    const manual = issuesOf({
      ...base,
      discounts: [{ kind: "manual", amount: 500, recurring: false, startsOn: "2026-02-01" }],
    });
    expect(manual).toEqual(["discounts.0.reason: A reason is required"]);
    const referral = issuesOf({
      ...base,
      discounts: [{ kind: "referral", amount: 500, recurring: false, startsOn: "2026-02-01" }],
    });
    expect(referral.length).toBe(2);
    const unknown = issuesOf({
      ...base,
      discounts: [{ kind: "gift", amount: 500, recurring: false, startsOn: "2026-02-01" }],
    });
    expect(unknown[0]).toContain("discounts.0.kind");
  });

  it("checks the end date of a discount", () => {
    const d = { kind: "manual", amount: 500, recurring: true, startsOn: "2026-02-01", reason: "r" };
    expect(issuesOf({ ...base, discounts: [{ ...d, endsOn: "2026-02-31" }] })).toEqual([
      "discounts.0.endsOn: Enter a real date written YYYY-MM-DD",
    ]);
    expect(issuesOf({ ...base, discounts: [{ ...d, endsOn: "2026-01-01" }] })).toEqual([
      "discounts.0.endsOn: Cannot be before startsOn",
    ]);
    expect(issuesOf({ ...base, discounts: [{ ...d, endsOn: "2026-06-01" }] })).toEqual([]);
  });
});

describe("parseBackfill", () => {
  it("refuses a file with too many members", () => {
    const many = Array.from({ length: MAX_BACKFILL_MEMBERS + 1 }, () => base);
    const result = parseBackfill(many, TODAY);
    expect(result.ok).toBe(false);
  });

  it("reports a repeated email at the place of the second one", () => {
    const result = parseBackfill([base, { ...base, email: "ada@x.test" }], TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues).toEqual([
        { path: ["members", 1, "email"], message: "This email is in the file twice" },
      ]);
    }
  });

  it("puts the member index in front of a member's problems", () => {
    const result = parseBackfill([base, { ...base, email: "b@x.test", fullName: "" }], TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.issues[0]?.path).toEqual(["members", 1, "fullName"]);
  });
});
