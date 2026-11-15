import { createPublicKey, createVerify, type JsonWebKeyInput } from "node:crypto";
import type { VerifyGoogleIdToken } from "../../app/google-sign-in";
import {
  type GoogleClaimsPolicy,
  type GoogleIdentity,
  type GoogleTokenRejection,
  validateGoogleClaims,
} from "../../domain/google-identity";
import type { Result } from "../../domain/result";
import { err } from "../../domain/result";

export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const DEFAULT_KEY_TTL_MS = 60 * 60 * 1000;

interface Jwk {
  readonly kid?: string;
  readonly kty?: string;
  readonly [field: string]: unknown;
}

export interface GoogleVerifierDeps {
  readonly fetch: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
  readonly nowMs: () => number;
  readonly policy: GoogleClaimsPolicy;
  readonly onReject?: (reason: GoogleTokenRejection) => void;
  readonly jwksUrl?: string;
  readonly keyTtlMs?: number;
}

function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Verifies a Google ID token: RS256 signature against Google's published keys, then the claims.
 * Keys are cached, and refetched once when a token names a key we do not have, which covers rotation.
 */
export function makeGoogleIdTokenVerifier(deps: GoogleVerifierDeps) {
  const url = deps.jwksUrl ?? GOOGLE_JWKS_URL;
  const ttl = deps.keyTtlMs ?? DEFAULT_KEY_TTL_MS;
  let keys: readonly Jwk[] = [];
  let fetchedAt = Number.NEGATIVE_INFINITY;

  async function refresh(): Promise<void> {
    const response = await deps.fetch(url);
    if (!response.ok) throw new Error("Could not fetch Google signing keys");
    const body = (await response.json()) as { keys?: unknown };
    keys = Array.isArray(body.keys) ? (body.keys as Jwk[]) : [];
    fetchedAt = deps.nowMs();
  }

  async function keyFor(kid: string): Promise<Jwk | undefined> {
    if (deps.nowMs() - fetchedAt >= ttl) await refresh();
    const cached = keys.find((key) => key.kid === kid);
    if (cached !== undefined) return cached;
    await refresh();
    return keys.find((key) => key.kid === kid);
  }

  async function check(idToken: string): Promise<Result<GoogleIdentity, GoogleTokenRejection>> {
    const parts = idToken.split(".");
    if (parts.length !== 3) return err("malformed");
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
    const header = decodeSegment(headerPart);
    const claims = decodeSegment(payloadPart);
    if (header === null || claims === null) return err("malformed");
    if (header.alg !== "RS256") return err("unsupported_algorithm");
    if (typeof header.kid !== "string") return err("unknown_key");
    const jwk = await keyFor(header.kid);
    if (jwk === undefined || jwk.kty !== "RSA") return err("unknown_key");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${headerPart}.${payloadPart}`);
    const valid = verifier.verify(
      createPublicKey({ key: jwk as JsonWebKeyInput["key"], format: "jwk" }),
      Buffer.from(signaturePart, "base64url"),
    );
    if (!valid) return err("bad_signature");
    return validateGoogleClaims(claims, deps.policy, Math.floor(deps.nowMs() / 1000));
  }

  const verify: VerifyGoogleIdToken = async (idToken) => {
    const result = await check(idToken);
    if (result.ok) return result.value;
    deps.onReject?.(result.error);
    return null;
  };
  return verify;
}
