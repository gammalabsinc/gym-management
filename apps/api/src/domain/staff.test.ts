import { describe, expect, it } from "vitest";
import {
  hasStaffAccess,
  isStaffRole,
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  parseInvite,
  parseUserId,
  wouldRemoveLastOwner,
} from "./staff";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("isStaffRole and hasStaffAccess", () => {
  it("knows owner and staff, and nothing else", () => {
    expect(isStaffRole("owner")).toBe(true);
    expect(isStaffRole("staff")).toBe(true);
    expect(isStaffRole("member")).toBe(false);
    expect(isStaffRole("OWNER")).toBe(false);
  });

  it("gives staff access to owners and staff, not to members alone", () => {
    expect(hasStaffAccess(["member", "staff"])).toBe(true);
    expect(hasStaffAccess(["owner"])).toBe(true);
    expect(hasStaffAccess(["member"])).toBe(false);
    expect(hasStaffAccess([])).toBe(false);
  });
});

describe("wouldRemoveLastOwner", () => {
  it("is true only for the one remaining owner", () => {
    expect(wouldRemoveLastOwner(["a"], "a")).toBe(true);
    expect(wouldRemoveLastOwner(["a", "b"], "a")).toBe(false);
  });

  it("is false for someone who is not an owner, even when no owner is left", () => {
    expect(wouldRemoveLastOwner(["a"], "b")).toBe(false);
    expect(wouldRemoveLastOwner([], "a")).toBe(false);
  });
});

describe("parseUserId", () => {
  it("accepts a uuid and lower cases it", () => {
    expect(parseUserId(` ${ID.toUpperCase()} `)).toEqual({ ok: true, value: ID });
  });

  it("rejects anything else", () => {
    const result = parseUserId("not-an-id");
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.issues).toEqual([{ path: ["userId"], message: "Invalid id" }]);
  });
});

describe("parseInvite", () => {
  it("normalises the email and name", () => {
    expect(parseInvite({ email: "  Sam@Example.COM ", name: "  Sam  ", role: "staff" })).toEqual({
      ok: true,
      value: { email: "sam@example.com", name: "Sam", role: "staff" },
    });
  });

  it("turns a missing, null or blank name into null", () => {
    for (const name of [undefined, null, "   "]) {
      const result = parseInvite({ email: "a@b.co", name, role: "owner" });
      expect(result).toEqual({ ok: true, value: { email: "a@b.co", name: null, role: "owner" } });
    }
  });

  it("reports every problem at once", () => {
    const result = parseInvite({
      email: `${"a".repeat(MAX_EMAIL_LENGTH)}@b.co`,
      name: "n".repeat(MAX_NAME_LENGTH + 1),
      role: "member",
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual(["email", "name", "role"]);
  });

  it("rejects an email without a domain", () => {
    expect(parseInvite({ email: "sam@", role: "staff" }).ok).toBe(false);
    expect(parseInvite({ email: "sam example@b.co", role: "staff" }).ok).toBe(false);
  });
});
