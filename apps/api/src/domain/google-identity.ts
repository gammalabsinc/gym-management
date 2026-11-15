import { err, ok, type Result } from "./result";

export const GOOGLE_ISSUERS: readonly string[] = [
  "accounts.google.com",
  "https://accounts.google.com",
];

/** The verified facts about a Google account. The subject never changes, the email can. */
export interface GoogleIdentity {
  readonly subject: string;
  readonly email: string;
  readonly name: string | null;
}

export type GoogleTokenRejection =
  | "malformed"
  | "unsupported_algorithm"
  | "unknown_key"
  | "bad_signature"
  | "wrong_issuer"
  | "wrong_audience"
  | "expired"
  | "email_not_verified"
  | "missing_subject"
  | "missing_email";

export interface GoogleClaimsPolicy {
  /** The iOS and Android client ids of the mobile app. */
  readonly audiences: readonly string[];
  /** Seconds a token may be past its expiry, to absorb clock drift. */
  readonly leewaySeconds: number;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Google sends email_verified as a boolean, and older tokens as the string "true". */
function isTrue(value: unknown): boolean {
  return value === true || value === "true";
}

/**
 * Checks the claims of a token whose signature is already proven.
 * Pure: the current time comes in as epoch seconds.
 */
export function validateGoogleClaims(
  claims: Readonly<Record<string, unknown>>,
  policy: GoogleClaimsPolicy,
  nowSeconds: number,
): Result<GoogleIdentity, GoogleTokenRejection> {
  const issuer = text(claims.iss);
  if (issuer === null || !GOOGLE_ISSUERS.includes(issuer)) return err("wrong_issuer");
  const audience = text(claims.aud);
  if (audience === null || !policy.audiences.includes(audience)) return err("wrong_audience");
  const expiry = claims.exp;
  if (
    typeof expiry !== "number" ||
    !Number.isFinite(expiry) ||
    expiry + policy.leewaySeconds <= nowSeconds
  ) {
    return err("expired");
  }
  const subject = text(claims.sub);
  if (subject === null) return err("missing_subject");
  const email = text(claims.email);
  if (email === null) return err("missing_email");
  if (!isTrue(claims.email_verified)) return err("email_not_verified");
  return ok({ subject, email: email.trim().toLowerCase(), name: text(claims.name) });
}
