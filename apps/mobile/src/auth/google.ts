import type { GoogleClientIds } from "../config/build-config";

/** What one tap on Continue with Google ends in. Cancelling is not a failure. */
export type GoogleResult =
  | { readonly status: "success"; readonly idToken: string }
  | { readonly status: "cancelled" }
  | { readonly status: "failed" };

export interface GoogleSignInPort {
  signIn(): Promise<GoogleResult>;
  /** Forgets the Google account on this device, so the next sign in asks which one. */
  signOut(): Promise<void>;
}

/** The part of @react-native-google-signin/google-signin used here. */
export interface GoogleSigninLike {
  configure(options: { iosClientId: string; webClientId: string }): void;
  signIn(): Promise<
    | { readonly type: "success"; readonly data: { readonly idToken: string | null } }
    | { readonly type: "cancelled"; readonly data: null }
  >;
  signOut(): Promise<unknown>;
}

/**
 * Wraps the native Google sheet. The ID token is handed to the caller and never kept or logged here.
 * The Android client id is passed as the web client id, which is what the Google library asks for
 * when it must return an ID token on Android.
 */
export function createGoogleSignIn(
  lib: GoogleSigninLike,
  ids: GoogleClientIds | null,
): GoogleSignInPort {
  let configured = false;
  function configureOnce(ids: GoogleClientIds): void {
    if (configured) return;
    lib.configure({ iosClientId: ids.ios, webClientId: ids.android });
    configured = true;
  }
  return {
    async signIn() {
      // The development profile has no client ids, so Google sign in cannot run there.
      if (ids === null) return { status: "failed" };
      try {
        configureOnce(ids);
        const response = await lib.signIn();
        if (response.type === "cancelled") return { status: "cancelled" };
        const idToken = response.data.idToken;
        return idToken === null || idToken === ""
          ? { status: "failed" }
          : { status: "success", idToken };
      } catch {
        return { status: "failed" };
      }
    },
    async signOut() {
      if (!configured) return;
      try {
        await lib.signOut();
      } catch {
        // The device is cleared either way. The next sign in shows the account chooser again.
      }
    },
  };
}
