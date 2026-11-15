import { describe, expect, it } from "vitest";
import { sessionTokens } from "./session-tokens";

describe("sessionTokens", () => {
  it("makes url safe tokens of 256 bits", () => {
    const { token } = sessionTokens.generate();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("never repeats a token", () => {
    const seen = new Set(Array.from({ length: 200 }, () => sessionTokens.generate().token));
    expect(seen.size).toBe(200);
  });

  it("returns the hash that hash() gives for the token, and the hash is not the token", () => {
    const { token, tokenHash } = sessionTokens.generate();
    expect(sessionTokens.hash(token)).toBe(tokenHash);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toContain(token);
  });

  it("hashes to a known SHA-256 value", () => {
    expect(sessionTokens.hash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
