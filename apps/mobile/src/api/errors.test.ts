import { describe, expect, it } from "vitest";
import { messageFor, toApiError } from "./errors";

describe("messageFor", () => {
  it("maps known codes to fixed user messages", () => {
    expect(messageFor("FORBIDDEN", "r1")).toBe("You do not have permission to do that.");
    expect(messageFor("RATE_LIMITED", null)).toContain("Too many attempts");
  });

  it("gives the masked internal error a generic message with the request id", () => {
    expect(messageFor("INTERNAL_SERVER_ERROR", "req-9")).toBe(
      "Something went wrong. Reference: req-9",
    );
    expect(messageFor("SOMETHING_NEW", null)).toBe("Something went wrong.");
  });
});

describe("toApiError", () => {
  it("never carries the raw server message", () => {
    const error = toApiError(
      [
        {
          message: "SELECT * FROM secrets failed",
          extensions: { code: "INTERNAL_SERVER_ERROR", requestId: "r7" },
        },
      ],
      "fallback",
    );
    expect(error.message).toBe("Something went wrong. Reference: r7");
    expect(JSON.stringify(error)).not.toContain("secrets");
    expect(error.requestId).toBe("r7");
  });

  it("keeps valid field issues and drops malformed ones", () => {
    const error = toApiError(
      [
        {
          extensions: {
            code: "BAD_USER_INPUT",
            issues: [{ field: "email", message: "Invalid email" }, { field: 1 }, "x"],
          },
        },
      ],
      "fallback",
    );
    expect(error.issues).toEqual([{ field: "email", message: "Invalid email" }]);
    expect(error.requestId).toBe("fallback");
  });

  it("treats anything unexpected as the generic internal error", () => {
    expect(toApiError(undefined, null).code).toBe("INTERNAL_SERVER_ERROR");
    expect(toApiError(["x"], "f").code).toBe("INTERNAL_SERVER_ERROR");
    expect(toApiError([{ extensions: { issues: "no" } }], "f").issues).toEqual([]);
  });
});
