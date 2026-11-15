import { describe, expect, it } from "vitest";
import { isSessionLive, MAX_TOKEN_LENGTH, parseBearerToken, type Session } from "./session";

const NOW = new Date("2026-01-10T12:00:00Z");

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    subject: "sub-1",
    expiresAt: new Date("2026-01-11T12:00:00Z"),
    revokedAt: null,
    ...overrides,
  };
}

describe("isSessionLive", () => {
  it("is live before expiry and not revoked", () => {
    expect(isSessionLive(session(), NOW)).toBe(true);
  });

  it("is not live at the expiry instant", () => {
    expect(isSessionLive(session({ expiresAt: NOW }), NOW)).toBe(false);
  });

  it("is not live after expiry", () => {
    expect(isSessionLive(session({ expiresAt: new Date("2026-01-10T11:59:59Z") }), NOW)).toBe(
      false,
    );
  });

  it("is not live once revoked, even before expiry", () => {
    expect(isSessionLive(session({ revokedAt: new Date("2026-01-10T11:00:00Z") }), NOW)).toBe(
      false,
    );
  });
});

describe("parseBearerToken", () => {
  it("returns the token of a bearer header", () => {
    expect(parseBearerToken("Bearer abc123")).toBe("abc123");
  });

  it("accepts any case for the scheme and ignores outer spaces", () => {
    expect(parseBearerToken("  bearer abc123  ")).toBe("abc123");
  });

  it.each([
    ["a missing header", undefined],
    ["a null header", null],
    ["an empty header", ""],
    ["another scheme", "Basic abc123"],
    ["a scheme without a token", "Bearer"],
    ["a token with a space in it", "Bearer abc def"],
  ])("returns null for %s", (_name, header) => {
    expect(parseBearerToken(header)).toBeNull();
  });

  it("returns null for a token longer than the limit", () => {
    expect(parseBearerToken(`Bearer ${"a".repeat(MAX_TOKEN_LENGTH + 1)}`)).toBeNull();
    expect(parseBearerToken(`Bearer ${"a".repeat(MAX_TOKEN_LENGTH)}`)).not.toBeNull();
  });
});
