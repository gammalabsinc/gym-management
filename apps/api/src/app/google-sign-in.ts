import { unauthenticated } from "../domain/errors";
import type { GoogleIdentity } from "../domain/google-identity";
import type { Result } from "../domain/result";
import { ok } from "../domain/result";
import type { GoogleUser, GoogleUserDirectory } from "./ports";

/** Proves a Google ID token and returns who it belongs to, or null when it cannot be trusted. */
export type VerifyGoogleIdToken = (idToken: string) => Promise<GoogleIdentity | null>;

export interface GoogleSignInDeps {
  readonly verify: VerifyGoogleIdToken;
  readonly users: GoogleUserDirectory;
}

/**
 * Signs a member or staff member in with a Google ID token. Every rejected token gives the same
 * answer, so a caller cannot tell a forged token from an expired one.
 */
export async function signInWithGoogle(
  deps: GoogleSignInDeps,
  tenantId: string,
  idToken: string,
): Promise<Result<GoogleUser, ReturnType<typeof unauthenticated>["error"]>> {
  const identity = await deps.verify(idToken);
  if (identity === null) return unauthenticated("Google sign in failed");
  return ok(await deps.users.upsertBySubject(tenantId, identity));
}
