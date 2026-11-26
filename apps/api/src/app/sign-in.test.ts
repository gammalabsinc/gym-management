import { describe, expect, it } from "vitest";
import { unauthenticated } from "../domain/errors";
import { ok } from "../domain/result";
import { makeSignIn, type SignInDeps } from "./sign-in";

const IDENTITY = { subject: "sub-1", email: "a@b.test", name: null };
const GYM = {
  tenantId: "t1",
  name: "Iron",
  subdomain: "iron",
  logoUrl: null,
  roles: ["owner" as const],
};

function setup(overrides: Partial<SignInDeps> = {}) {
  const issued: string[] = [];
  const deps: SignInDeps = {
    google: {
      verify: async (token) => (token === "good" ? IDENTITY : null),
      accounts: { claim: async () => [] },
    },
    sessions: {
      issue: async (subject) => {
        issued.push(subject);
        return { token: "tok", expiresAt: new Date("2030-01-01T00:00:00Z") };
      },
    },
    listMyGyms: async () => ok([GYM]),
    ...overrides,
  };
  return { signIn: makeSignIn(deps), issued };
}

describe("makeSignIn", () => {
  it("issues a session for a verified token and lists the gyms", async () => {
    const { signIn, issued } = setup();
    const result = await signIn("good");
    expect(result).toEqual({
      ok: true,
      value: { token: "tok", expiresAt: new Date("2030-01-01T00:00:00Z"), gyms: [GYM] },
    });
    expect(issued).toEqual(["sub-1"]);
  });

  it("opens no session for a token that cannot be trusted", async () => {
    const { signIn, issued } = setup();
    const result = await signIn("bad");
    expect(result.ok).toBe(false);
    expect(issued).toEqual([]);
  });

  it("opens no session when the gym list cannot be read", async () => {
    const { signIn, issued } = setup({ listMyGyms: async () => unauthenticated() });
    expect((await signIn("good")).ok).toBe(false);
    expect(issued).toEqual([]);
  });
});
