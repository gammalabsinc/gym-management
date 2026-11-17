import { describe, expect, it } from "vitest";
import { unauthenticated } from "../domain/errors";
import type { GymSummary } from "../domain/gym-picker";
import { ok } from "../domain/result";
import type { FindMembership } from "./gym-membership";
import { makeResolveRequestSession } from "./request-session";
import type { AuthenticatedSession } from "./sessions";

const GYM = "11111111-1111-4111-8111-111111111111";
const summary: GymSummary = {
  tenantId: GYM,
  name: "Alpha",
  subdomain: "alpha",
  logoUrl: null,
  roles: ["owner"],
};

function setup(session: AuthenticatedSession | null, membership = true) {
  const tokens: string[] = [];
  const checked: string[] = [];
  const findMembership: FindMembership = async (subject, gymId) => {
    checked.push(`${subject}:${gymId}`);
    return membership ? { userId: "u1", gym: summary } : null;
  };
  const resolve = makeResolveRequestSession({
    sessions: {
      authenticate: async (token) => {
        tokens.push(token);
        return session === null ? unauthenticated() : ok(session);
      },
    },
    findMembership,
  });
  return { resolve, tokens, checked };
}

describe("resolving the session of a request", () => {
  it("is no session without a bearer token, and never asks the store", async () => {
    const { resolve, tokens } = setup({ sessionId: "s", subject: "sub", gymId: null });
    expect(await resolve(null)).toBeNull();
    expect(await resolve("Basic abc")).toBeNull();
    expect(tokens).toEqual([]);
  });

  it("is no session for an unknown, expired or revoked token", async () => {
    const { resolve, tokens } = setup(null);
    expect(await resolve("Bearer abc")).toBeNull();
    expect(tokens).toEqual(["abc"]);
  });

  it("is an identity session while no gym is picked", async () => {
    const { resolve, checked } = setup({ sessionId: "s", subject: "sub", gymId: null });
    expect(await resolve("Bearer abc")).toEqual({ subject: "sub", userId: null, tenantId: null });
    expect(checked).toEqual([]);
  });

  it("carries the bound gym and the user row there while the role still holds", async () => {
    const { resolve, checked } = setup({ sessionId: "s", subject: "sub", gymId: GYM });
    expect(await resolve("Bearer abc")).toEqual({ subject: "sub", userId: "u1", tenantId: GYM });
    expect(checked).toEqual([`sub:${GYM}`]);
  });

  it("falls back to an identity session when the role was lost after the gym was picked", async () => {
    const { resolve } = setup({ sessionId: "s", subject: "sub", gymId: GYM }, false);
    expect(await resolve("Bearer abc")).toEqual({ subject: "sub", userId: null, tenantId: null });
  });
});
