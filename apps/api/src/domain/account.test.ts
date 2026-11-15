import { describe, expect, it } from "vitest";
import { hasSignedIn } from "./account";

describe("hasSignedIn", () => {
  it("is false for a row that is only invited", () => {
    expect(hasSignedIn({ authSubject: null })).toBe(false);
  });

  it("is false for a blank subject, which is never a real link", () => {
    expect(hasSignedIn({ authSubject: "" })).toBe(false);
  });

  it("is true once a subject is linked", () => {
    expect(hasSignedIn({ authSubject: "sub-1" })).toBe(true);
  });
});
