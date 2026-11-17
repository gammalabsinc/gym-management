import { describe, expect, it } from "vitest";
import { type OnboardGymInput, parseNewGym } from "./onboarding";
import { DEFAULT_SETTINGS } from "./tenant";

const VALID: OnboardGymInput = {
  name: "Iron Works",
  subdomain: "iron-works",
  timezone: "America/Toronto",
  currency: "CAD",
  ownerEmail: "owner@example.test",
  admissionFee: 2000,
  monthlyFee: 5000,
};

function issuesOf(overrides: Partial<OnboardGymInput>): string[] {
  const result = parseNewGym({ ...VALID, ...overrides });
  if (result.ok) throw new Error("expected the gym to be refused");
  return result.error.issues.map((issue) => issue.path.join("."));
}

describe("parseNewGym", () => {
  it("builds the gym with the default settings, the owner and the default plan", () => {
    const result = parseNewGym({ ...VALID, ownerName: "Sam Owner" });
    expect(result).toEqual({
      ok: true,
      value: {
        name: "Iron Works",
        subdomain: "iron-works",
        timezone: "America/Toronto",
        currency: "CAD",
        settings: DEFAULT_SETTINGS,
        owner: { email: "owner@example.test", name: "Sam Owner", role: "owner" },
        plan: { key: "default", name: "Default", admissionFee: 2000, monthlyFee: 5000 },
      },
    });
  });

  it("puts every field in the form it is stored in", () => {
    const result = parseNewGym({
      ...VALID,
      name: "  Iron Works  ",
      subdomain: " Iron-Works ",
      timezone: " UTC ",
      currency: " cad ",
      ownerEmail: " Owner@Example.TEST ",
    });
    expect(result.ok && result.value).toMatchObject({
      name: "Iron Works",
      subdomain: "iron-works",
      timezone: "UTC",
      currency: "CAD",
      owner: { email: "owner@example.test", name: null },
    });
  });

  it("accepts fees of zero", () => {
    const result = parseNewGym({ ...VALID, admissionFee: 0, monthlyFee: 0 });
    expect(result.ok && result.value.plan).toMatchObject({ admissionFee: 0, monthlyFee: 0 });
  });

  it("refuses a missing or too long name", () => {
    expect(issuesOf({ name: "   " })).toEqual(["name"]);
    expect(issuesOf({ name: "x".repeat(121) })).toEqual(["name"]);
  });

  it("refuses a subdomain that is not a DNS label", () => {
    for (const subdomain of ["", "-gym", "gym-", "iron works", "iron_works", "a".repeat(64), "é"]) {
      expect(issuesOf({ subdomain })).toEqual(["subdomain"]);
    }
  });

  it("refuses a time zone that is not an IANA name", () => {
    for (const timezone of ["", "Mars/Olympus", "+01:00", "Toronto time", "Not/AZone"]) {
      expect(issuesOf({ timezone })).toEqual(["timezone"]);
    }
  });

  it("refuses a currency that is not three letters", () => {
    for (const currency of ["", "CA", "CADD", "C4D"]) {
      expect(issuesOf({ currency })).toEqual(["currency"]);
    }
  });

  it("refuses a bad owner email and bad fees, and reports every problem at once", () => {
    expect(issuesOf({ ownerEmail: "not an email" })).toEqual(["email"]);
    expect(issuesOf({ monthlyFee: -1 })).toEqual(["monthlyFee"]);
    expect(issuesOf({ admissionFee: 1.5, ownerName: "x".repeat(121) })).toEqual([
      "name",
      "admissionFee",
    ]);
    expect(issuesOf({ name: "", currency: "x", ownerEmail: "bad", monthlyFee: -1 })).toEqual([
      "name",
      "currency",
      "email",
      "monthlyFee",
    ]);
  });
});
