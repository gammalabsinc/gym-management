import { type UnauthenticatedError, unauthenticated } from "../domain/errors";
import type { GoogleIdentity } from "../domain/google-identity";
import type { Result } from "../domain/result";
import { ok } from "../domain/result";
import type { AccountDirectory, GymAccount } from "./ports";

/** Proves a Google ID token and returns who it belongs to, or null when it cannot be trusted. */
export type VerifyGoogleIdToken = (idToken: string) => Promise<GoogleIdentity | null>;

export interface GoogleSignInDeps {
  readonly verify: VerifyGoogleIdToken;
  readonly accounts: AccountDirectory;
}

export interface GoogleSignIn {
  readonly identity: GoogleIdentity;
  /** The gyms this account has a row in. Empty for an email nobody has added yet. */
  readonly gyms: readonly GymAccount[];
}

/**
 * Signs a person in with a Google ID token and claims the rows that were added for their email.
 * Every rejected token gives the same answer, so a caller cannot tell a forged token from an
 * expired one. A verified email with no rows still signs in, with no gyms.
 */
export async function signInWithGoogle(
  deps: GoogleSignInDeps,
  idToken: string,
): Promise<Result<GoogleSignIn, UnauthenticatedError>> {
  const identity = await deps.verify(idToken);
  if (identity === null) return unauthenticated("Google sign in failed");
  const gyms = await deps.accounts.claim(identity);
  return ok({ identity, gyms });
}
