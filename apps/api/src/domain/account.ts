/** The part of a user row that says whether the person behind it has ever signed in. */
export interface SignInState {
  readonly authSubject: string | null;
}

/** A row added by email stays Invited until the Google subject has been linked to it. */
export function hasSignedIn(user: SignInState): boolean {
  return user.authSubject !== null && user.authSubject !== "";
}
