import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  isMemberCode,
  MAX_BACKDATE_DAYS,
  MAX_MEMBER_NAME_LENGTH,
  type NewMemberInput,
  parseNewMember,
} from "./member";

const TODAY = "2026-11-16";
const REFERRER = "11111111-1111-4111-8111-111111111111";

const valid: NewMemberInput = {
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  joinDate: "2026-11-16",
};

const issuesOf = (input: NewMemberInput, today = TODAY) => {
  const result = parseNewMember(input, today);
  return result.ok ? [] : result.error.issues.map((issue) => issue.path.join("."));
};

describe("parsing a new member", () => {
  it("normalizes the fields and takes the billing day from the join date", () => {
    const result = parseNewMember(
      {
        fullName: "  Ada Lovelace ",
        email: " Ada@Example.COM ",
        phone: " +1 (416) 555-0100 ",
        joinDate: " 2026-10-31 ",
        referredBy: REFERRER.toUpperCase(),
      },
      TODAY,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        fullName: "Ada Lovelace",
        email: "ada@example.com",
        phone: "+1 (416) 555-0100",
        joinDate: "2026-10-31",
        referredBy: REFERRER,
        billingDay: 31,
      },
    });
  });

  it("leaves a blank or missing phone and referrer empty", () => {
    for (const extra of [{}, { phone: "  ", referredBy: null }, { phone: null }]) {
      expect(parseNewMember({ ...valid, ...extra }, TODAY)).toMatchObject({
        ok: true,
        value: { phone: null, referredBy: null },
      });
    }
  });

  it("accepts a join date of today and the oldest one allowed", () => {
    expect(issuesOf(valid)).toEqual([]);
    expect(issuesOf({ ...valid, joinDate: "2025-11-15" })).toEqual([]);
    expect(MAX_BACKDATE_DAYS).toBe(366);
  });

  it("reports every problem at once", () => {
    expect(
      issuesOf({
        fullName: " ",
        email: "nope",
        phone: "abc",
        joinDate: "2026-02-30",
        referredBy: "x",
      }),
    ).toEqual(["fullName", "email", "phone", "joinDate", "referredBy"]);
  });

  it("refuses a name that is too long", () => {
    expect(issuesOf({ ...valid, fullName: "n".repeat(MAX_MEMBER_NAME_LENGTH + 1) })).toEqual([
      "fullName",
    ]);
  });

  it("refuses a join date in the gym's future or more than a year back", () => {
    expect(issuesOf({ ...valid, joinDate: "2026-11-17" })).toEqual(["joinDate"]);
    expect(issuesOf({ ...valid, joinDate: "2025-11-14" })).toEqual(["joinDate"]);
  });
});

describe("member codes", () => {
  it("are six characters of uppercase letters and digits", () => {
    expect(CODE_LENGTH).toBe(6);
    expect(isMemberCode("AB12Z9")).toBe(true);
    for (const bad of ["", "ab12z9", "AB12Z", "AB12Z99", "AB 2Z9", "AB12Z-"]) {
      expect(isMemberCode(bad)).toBe(false);
    }
    expect([...CODE_ALPHABET].every((char) => isMemberCode(char.repeat(CODE_LENGTH)))).toBe(true);
  });
});
