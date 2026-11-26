import type { UnauthenticatedError } from "../domain/errors";
import type { GymSummary } from "../domain/gym-picker";
import { ok, type Result } from "../domain/result";
import type { GoogleSignInDeps } from "./google-sign-in";
import { signInWithGoogle } from "./google-sign-in";
import type { makeListMyGyms } from "./gym-picker";
import type { Sessions } from "./sessions";

export interface SignInDeps {
  readonly google: GoogleSignInDeps;
  readonly sessions: Pick<Sessions, "issue">;
  readonly listMyGyms: ReturnType<typeof makeListMyGyms>;
}

export interface SignedIn {
  /** Shown to the client once. */
  readonly token: string;
  readonly expiresAt: Date;
  readonly gyms: readonly GymSummary[];
}

/**
 * Proves the Google token, claims the rows waiting for the email, opens an identity session and
 * lists the gyms the person can pick. A person with no gym yet still gets a session and an empty list.
 */
export function makeSignIn(deps: SignInDeps) {
  return async (idToken: string): Promise<Result<SignedIn, UnauthenticatedError>> => {
    const signedIn = await signInWithGoogle(deps.google, idToken);
    if (!signedIn.ok) return signedIn;
    const { subject } = signedIn.value.identity;
    const gyms = await deps.listMyGyms(undefined, { subject });
    if (!gyms.ok) return gyms;
    const issued = await deps.sessions.issue(subject);
    return ok({ token: issued.token, expiresAt: issued.expiresAt, gyms: gyms.value });
  };
}
