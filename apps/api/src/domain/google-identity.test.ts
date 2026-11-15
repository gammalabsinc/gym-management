import { describe, expect, it } from "vitest";
import { type GoogleClaimsPolicy, validateGoogleClaims } from "./google-identity";

const POLICY: GoogleClaimsPolicy = {
  audiences: ["ios-client", "android-client"],
  leewaySeconds: 30,
};
const NOW = 1_800_000_000;

const valid = {
  iss: "https://accounts.google.com",
  aud: "ios-client",
  exp: NOW + 600,
  sub: "1234567890",
  email: "Member@Example.com",
  email_verified: true,
  name: "Ada Member",
};

function rejection(overrides: Record<string, unknown>): unknown {
  const result = validateGoogleClaims({ ...valid, ...overrides }, POLICY, NOW);
  return result.ok ? "accepted" : result.error;
}

describe("validateGoogleClaims", () => {
  it("accepts a good token and lowercases the email", () => {
    expect(validateGoogleClaims(valid, POLICY, NOW)).toEqual({
      ok: true,
      value: { subject: "1234567890", email: "member@example.com", name: "Ada Member" },
    });
  });

  it("accepts both Google issuers, both client ids and the string form of email_verified", () => {
    expect(rejection({ iss: "accounts.google.com" })).toBe("accepted");
    expect(rejection({ aud: "android-client" })).toBe("accepted");
    expect(rejection({ email_verified: "true" })).toBe("accepted");
  });

  it("rejects a token for another client id", () => {
    expect(rejection({ aud: "someone-elses-client" })).toBe("wrong_audience");
    expect(rejection({ aud: ["ios-client"] })).toBe("wrong_audience");
    expect(rejection({ aud: undefined })).toBe("wrong_audience");
  });

  it("rejects another issuer", () => {
    expect(rejection({ iss: "https://evil.example.com" })).toBe("wrong_issuer");
    expect(rejection({ iss: undefined })).toBe("wrong_issuer");
  });

  it("rejects an expired token, with a small leeway for clock drift", () => {
    expect(rejection({ exp: NOW - 31 })).toBe("expired");
    expect(rejection({ exp: NOW - 30 })).toBe("expired");
    expect(rejection({ exp: NOW - 29 })).toBe("accepted");
    expect(rejection({ exp: "soon" })).toBe("expired");
    expect(rejection({ exp: Number.NaN })).toBe("expired");
  });

  it("rejects an unverified email, and a missing subject or email", () => {
    expect(rejection({ email_verified: false })).toBe("email_not_verified");
    expect(rejection({ email_verified: "false" })).toBe("email_not_verified");
    expect(rejection({ email_verified: undefined })).toBe("email_not_verified");
    expect(rejection({ sub: "  " })).toBe("missing_subject");
    expect(rejection({ email: undefined })).toBe("missing_email");
  });

  it("treats a missing name as null", () => {
    const result = validateGoogleClaims({ ...valid, name: undefined }, POLICY, NOW);
    expect(result.ok && result.value.name).toBeNull();
  });
});
