import { describe, expect, it, vi } from "vitest";
import { signInWithGoogle } from "./google-sign-in";
import type { GoogleUserDirectory } from "./ports";

const identity = { subject: "sub-1", email: "a@example.com", name: "A" };
const user = { id: "u1", tenantId: "t1", email: "a@example.com", name: "A" };

describe("signInWithGoogle", () => {
  it("upserts the verified identity into the tenant and returns the user", async () => {
    const upsertBySubject = vi.fn(async () => user);
    const users: GoogleUserDirectory = { upsertBySubject };
    const result = await signInWithGoogle({ verify: async () => identity, users }, "t1", "token");
    expect(result).toEqual({ ok: true, value: user });
    expect(upsertBySubject).toHaveBeenCalledWith("t1", identity);
  });

  it("answers unauthenticated and touches no user when the token is rejected", async () => {
    const upsertBySubject = vi.fn();
    const result = await signInWithGoogle(
      { verify: async () => null, users: { upsertBySubject } },
      "t1",
      "forged",
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: "unauthenticated", message: "Google sign in failed" },
    });
    expect(upsertBySubject).not.toHaveBeenCalled();
  });
});
