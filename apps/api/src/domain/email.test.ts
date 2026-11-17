import { describe, expect, it } from "vitest";
import { isEmailAddress, MAX_EMAIL_LENGTH, normalizeEmail } from "./email";

describe("emails", () => {
  it("trims and lower cases an email", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it("accepts the shape name@host.tld and refuses anything else", () => {
    expect(isEmailAddress("ada@example.com")).toBe(true);
    for (const bad of ["", "ada", "ada@", "@example.com", "ada@example", "a da@example.com"]) {
      expect(isEmailAddress(bad)).toBe(false);
    }
  });

  it("refuses an email that is too long", () => {
    expect(isEmailAddress(`${"a".repeat(MAX_EMAIL_LENGTH)}@b.co`)).toBe(false);
  });
});
