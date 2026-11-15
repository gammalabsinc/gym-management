import { describe, expect, it, vi } from "vitest";
import { validateGoogleClaims } from "../domain/google-identity";
import { signInWithGoogle } from "./google-sign-in";
import type { AccountDirectory, GymAccount } from "./ports";

const identity = { subject: "sub-1", email: "a@example.com", name: "A" };
const gyms: GymAccount[] = [{ userId: "u1", tenantId: "t1" }];

describe("signInWithGoogle", () => {
  it("claims the verified identity and returns the gyms it belongs to", async () => {
    const claim = vi.fn(async () => gyms);
    const accounts: AccountDirectory = { claim };
    const result = await signInWithGoogle({ verify: async () => identity, accounts }, "token");
    expect(result).toEqual({ ok: true, value: { identity, gyms } });
    expect(claim).toHaveBeenCalledWith(identity);
  });

  it("signs in a verified email with no rows, with no gyms", async () => {
    const accounts: AccountDirectory = { claim: async () => [] };
    const result = await signInWithGoogle({ verify: async () => identity, accounts }, "token");
    expect(result).toEqual({ ok: true, value: { identity, gyms: [] } });
  });

  it("answers unauthenticated and claims nothing when the token is rejected", async () => {
    const claim = vi.fn();
    const result = await signInWithGoogle(
      { verify: async () => null, accounts: { claim } },
      "forged",
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: "unauthenticated", message: "Google sign in failed" },
    });
    expect(claim).not.toHaveBeenCalled();
  });

  it("claims nothing for a token whose email is not verified", async () => {
    const claim = vi.fn();
    const verify = async () => {
      const checked = validateGoogleClaims(
        {
          iss: "accounts.google.com",
          aud: "ios-client",
          exp: 2_000_000_000,
          sub: "sub-1",
          email: "a@example.com",
          email_verified: false,
        },
        { audiences: ["ios-client"], leewaySeconds: 0 },
        1_000_000_000,
      );
      return checked.ok ? checked.value : null;
    };
    const result = await signInWithGoogle({ verify, accounts: { claim } }, "token");
    expect(result.ok).toBe(false);
    expect(claim).not.toHaveBeenCalled();
  });
});
