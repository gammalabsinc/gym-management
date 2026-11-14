import { describe, expect, it } from "vitest";
import {
  conflict,
  DOMAIN_ERROR_KINDS,
  forbidden,
  isDomainError,
  notFound,
  unauthenticated,
  validationError,
} from "./errors";

describe("error constructors", () => {
  it("build failed Results with the matching kind", () => {
    expect(validationError("bad", [{ path: ["a"], message: "x" }])).toEqual({
      ok: false,
      error: { kind: "validation", message: "bad", issues: [{ path: ["a"], message: "x" }] },
    });
    expect(validationError("bad").error.issues).toEqual([]);
    expect(unauthenticated().error).toEqual({
      kind: "unauthenticated",
      message: "Sign in required",
    });
    expect(forbidden("no").error).toEqual({ kind: "forbidden", message: "no" });
    expect(forbidden().error.message).toBe("Not allowed");
    expect(notFound().error).toEqual({ kind: "not_found", message: "Not found" });
    expect(notFound("gone").error.message).toBe("gone");
    expect(conflict("dup").error).toEqual({ kind: "conflict", message: "dup" });
  });
});

describe("isDomainError", () => {
  it.each(DOMAIN_ERROR_KINDS)("accepts kind %s", (kind) => {
    expect(isDomainError({ kind, message: "m" })).toBe(true);
  });

  it.each([
    null,
    undefined,
    "validation",
    42,
    {},
    new Error("boom"),
    { kind: "validation" },
    { kind: "teapot", message: "m" },
    { kind: 5, message: "m" },
    { kind: "conflict", message: 5 },
  ])("rejects %j", (value) => {
    expect(isDomainError(value)).toBe(false);
  });
});
