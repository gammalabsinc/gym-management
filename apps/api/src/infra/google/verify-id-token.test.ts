import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { GoogleTokenRejection } from "../../domain/google-identity";
import { makeGoogleIdTokenVerifier } from "./verify-id-token";

const NOW_MS = 1_800_000_000_000;
const POLICY = { audiences: ["ios-client", "android-client"], leewaySeconds: 0 };

function makeKey(kid: string) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256" } };
}

const key = makeKey("key-1");
const otherKey = makeKey("key-2");

const claims = {
  iss: "https://accounts.google.com",
  aud: "ios-client",
  exp: NOW_MS / 1000 + 600,
  sub: "google-sub-1",
  email: "member@example.com",
  email_verified: true,
  name: "Ada",
};

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(
  payload: Record<string, unknown>,
  signer = key,
  header: Record<string, unknown> = { alg: "RS256", kid: signer.kid },
): string {
  const body = `${encode(header)}.${encode(payload)}`;
  const signature = createSign("RSA-SHA256")
    .update(body)
    .sign(signer.privateKey)
    .toString("base64url");
  return `${body}.${signature}`;
}

function setup(published: readonly unknown[] = [key.jwk], options: { ok?: boolean } = {}) {
  const fetch = vi.fn(async () => ({
    ok: options.ok ?? true,
    json: async () => ({ keys: published }),
  }));
  const rejected: GoogleTokenRejection[] = [];
  let nowMs = NOW_MS;
  const verify = makeGoogleIdTokenVerifier({
    fetch,
    nowMs: () => nowMs,
    policy: POLICY,
    onReject: (reason) => rejected.push(reason),
  });
  return { verify, fetch, rejected, advance: (ms: number) => (nowMs += ms) };
}

describe("makeGoogleIdTokenVerifier", () => {
  it("returns the identity for a correctly signed token", async () => {
    const { verify, rejected } = setup();
    expect(await verify(sign(claims))).toEqual({
      subject: "google-sub-1",
      email: "member@example.com",
      name: "Ada",
    });
    expect(rejected).toEqual([]);
  });

  it("rejects a token for another client id", async () => {
    const { verify, rejected } = setup();
    expect(await verify(sign({ ...claims, aud: "other-app" }))).toBeNull();
    expect(rejected).toEqual(["wrong_audience"]);
  });

  it("rejects a token signed by a key Google did not publish", async () => {
    const { verify, rejected } = setup();
    const forged = sign(claims, { ...otherKey, kid: "key-1" });
    expect(await verify(forged)).toBeNull();
    expect(rejected).toEqual(["bad_signature"]);
  });

  it("rejects a tampered payload", async () => {
    const { verify, rejected } = setup();
    const [h, , s] = sign(claims).split(".") as [string, string, string];
    expect(await verify(`${h}.${encode({ ...claims, sub: "someone-else" })}.${s}`)).toBeNull();
    expect(rejected).toEqual(["bad_signature"]);
  });

  it("rejects malformed tokens and unsupported algorithms", async () => {
    const { verify, rejected } = setup();
    expect(await verify("not-a-jwt")).toBeNull();
    expect(await verify("%%%.%%%.sig")).toBeNull();
    expect(await verify(`${encode([1])}.${encode(claims)}.sig`)).toBeNull();
    expect(await verify(sign(claims, key, { alg: "none", kid: "key-1" }))).toBeNull();
    expect(rejected).toEqual(["malformed", "malformed", "malformed", "unsupported_algorithm"]);
  });

  it("rejects a token with no key id, an unknown key id, or a non RSA key", async () => {
    const { verify, rejected } = setup([key.jwk, { kty: "EC", kid: "ec-key" }]);
    expect(await verify(sign(claims, key, { alg: "RS256" }))).toBeNull();
    expect(await verify(sign(claims, otherKey))).toBeNull();
    expect(await verify(sign(claims, key, { alg: "RS256", kid: "ec-key" }))).toBeNull();
    expect(rejected).toEqual(["unknown_key", "unknown_key", "unknown_key"]);
  });

  it("caches the keys, and refetches after the ttl", async () => {
    const { verify, fetch, advance } = setup();
    await verify(sign(claims));
    await verify(sign(claims));
    expect(fetch).toHaveBeenCalledTimes(1);
    advance(61 * 60 * 1000);
    await verify(sign({ ...claims, exp: NOW_MS / 1000 + 7200 }));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refetches once when a token names a key rotated in after the cache filled", async () => {
    const published: unknown[] = [key.jwk];
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ keys: [...published] }) }));
    const verify = makeGoogleIdTokenVerifier({ fetch, nowMs: () => NOW_MS, policy: POLICY });
    await verify(sign(claims));
    published.push(otherKey.jwk);
    expect((await verify(sign(claims, otherKey)))?.subject).toBe("google-sub-1");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("throws when Google's keys cannot be fetched, and treats a body without keys as empty", async () => {
    await expect(setup([], { ok: false }).verify(sign(claims))).rejects.toThrow(
      "Could not fetch Google signing keys",
    );
    const verify = makeGoogleIdTokenVerifier({
      fetch: async () => ({ ok: true, json: async () => ({}) }),
      nowMs: () => NOW_MS,
      policy: POLICY,
      jwksUrl: "https://example.test/keys",
      keyTtlMs: 1000,
    });
    expect(await verify(sign(claims))).toBeNull();
  });

  it("works without an onReject callback", async () => {
    const verify = makeGoogleIdTokenVerifier({
      fetch: async () => ({ ok: true, json: async () => ({ keys: [key.jwk] }) }),
      nowMs: () => NOW_MS,
      policy: POLICY,
    });
    expect(await verify("bad")).toBeNull();
  });
});
