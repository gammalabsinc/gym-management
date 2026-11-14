import { describe, expect, it } from "vitest";
import { z } from "zod";
import { conflict, forbidden, notFound, unauthenticated, validationError } from "../domain/errors";
import { ERROR_CODE_BY_KIND, MASKED_MESSAGE, makeErrorMapper, UNKNOWN_REQUEST_ID } from "./errors";

function setup() {
  const reported: { cause: unknown; requestId: string }[] = [];
  const mapError = makeErrorMapper((cause, requestId) => reported.push({ cause, requestId }));
  return { mapError, reported };
}

describe("makeErrorMapper", () => {
  it.each([
    [unauthenticated().error, "UNAUTHENTICATED"],
    [forbidden().error, "FORBIDDEN"],
    [notFound().error, "NOT_FOUND"],
    [conflict("dup").error, "CONFLICT"],
  ] as const)("maps %j to %s with the request id", (error, code) => {
    const { mapError, reported } = setup();
    expect(mapError(error, "req-1")).toEqual({
      message: error.message,
      extensions: { code, requestId: "req-1" },
    });
    expect(reported).toEqual([]);
  });

  it("maps a validation error and keeps its field issues", () => {
    const { mapError } = setup();
    const issues = [{ path: ["name"], message: "Required" }];
    expect(mapError(validationError("Invalid input", issues).error, "r")).toEqual({
      message: "Invalid input",
      extensions: { code: "BAD_USER_INPUT", requestId: "r", issues },
    });
  });

  it("maps a thrown ZodError to a validation error", () => {
    const { mapError, reported } = setup();
    const parsed = z.object({ name: z.string().min(1) }).safeParse({ name: "" });
    if (parsed.success) throw new Error("expected the parse to fail");
    const mapped = mapError(parsed.error, "r");
    expect(mapped.extensions.code).toBe("BAD_USER_INPUT");
    expect(mapped.extensions.issues?.[0]?.path).toEqual(["name"]);
    expect(reported).toEqual([]);
  });

  it("drops symbol path parts from zod issues", () => {
    const { mapError } = setup();
    const error = new z.ZodError([{ code: "custom", message: "bad", path: [Symbol("s"), "a", 1] }]);
    expect(mapError(error, "r").extensions.issues).toEqual([{ path: ["a", 1], message: "bad" }]);
  });

  it.each([
    new Error("secret db password in message"),
    "a string",
    null,
    undefined,
    { stack: "at x", message: "m" },
  ])("masks the unknown error %j and reports the cause", (cause) => {
    const { mapError, reported } = setup();
    const mapped = mapError(cause, "req-9");
    expect(mapped).toEqual({
      message: MASKED_MESSAGE,
      extensions: { code: "INTERNAL_SERVER_ERROR", requestId: "req-9" },
    });
    expect(JSON.stringify(mapped)).not.toMatch(/secret|stack|at x/);
    expect(reported).toEqual([{ cause, requestId: "req-9" }]);
  });

  it.each(["", "   "])("falls back to a placeholder id for blank request id %j", (blank) => {
    const { mapError, reported } = setup();
    expect(mapError(notFound().error, blank).extensions.requestId).toBe(UNKNOWN_REQUEST_ID);
    expect(mapError(new Error("x"), blank).extensions.requestId).toBe(UNKNOWN_REQUEST_ID);
    expect(reported[0]?.requestId).toBe(UNKNOWN_REQUEST_ID);
  });

  it("has a code for every domain error kind", () => {
    expect(Object.keys(ERROR_CODE_BY_KIND).sort()).toEqual([
      "conflict",
      "forbidden",
      "not_found",
      "unauthenticated",
      "validation",
    ]);
  });
});
