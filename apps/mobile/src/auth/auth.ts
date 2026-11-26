import type { Client } from "../api/client";
import { mutation } from "../api/operation";
import type { GoogleSignInPort } from "./google";
import type { SessionStore } from "./session-store";
import type { TokenStorage } from "./token-storage";

export type SignInResult =
  | { readonly status: "signedIn" }
  | { readonly status: "cancelled" }
  | { readonly status: "failed"; readonly kind: "network" | "error"; readonly message: string };

export interface SignOutResult {
  /** The server confirmed the session is revoked. False when the server could not be reached. */
  readonly revoked: boolean;
  /** The token is gone from secure storage. */
  readonly cleared: boolean;
}

export interface Auth {
  /** One sign in at a time: a second call while one runs returns the same promise. */
  signIn(): Promise<SignInResult>;
  /** Revokes the session on the server, then clears the device whatever the server said. */
  signOut(): Promise<SignOutResult>;
  /** The server said the session is gone: clear the device without calling the server again. */
  expire(): Promise<SignOutResult>;
  /** Reads the token kept on the device, so the person is still signed in after a restart. */
  restore(): Promise<void>;
}

export interface AuthDeps {
  readonly google: GoogleSignInPort;
  readonly client: Pick<Client, "execute">;
  readonly storage: TokenStorage;
  readonly store: SessionStore;
}

export const GOOGLE_FAILED_MESSAGE = "Google sign in did not finish. Try again.";
export const REJECTED_MESSAGE = "We could not sign you in with that Google account.";
export const STORAGE_FAILED_MESSAGE =
  "Signed in, but this device could not keep the session safe. Try again.";

const signInOperation = (idToken: string) =>
  mutation("SignIn", {
    signIn: {
      args: { idToken },
      select: { token: true, expiresAt: true, errors: { code: true } },
    },
  });

const signOutOperation = mutation("SignOut", { signOut: true });

function failed(kind: "network" | "error", message: string): SignInResult {
  return { status: "failed", kind, message };
}

export function createAuth(deps: AuthDeps): Auth {
  let inFlight: Promise<SignInResult> | null = null;

  async function exchange(idToken: string): Promise<SignInResult> {
    const outcome = await deps.client.execute(signInOperation(idToken));
    switch (outcome.status) {
      case "network":
        return failed("network", outcome.message);
      case "error":
        return failed("error", outcome.error.message);
      case "empty":
        return failed("error", REJECTED_MESSAGE);
      case "data": {
        const payload = outcome.data.signIn;
        if (payload.errors.length > 0 || payload.token === null) {
          return failed("error", REJECTED_MESSAGE);
        }
        try {
          await deps.storage.write(payload.token);
        } catch {
          return failed("error", STORAGE_FAILED_MESSAGE);
        }
        deps.store.signInIdentity(payload.token);
        return { status: "signedIn" };
      }
    }
  }

  async function run(): Promise<SignInResult> {
    const google = await deps.google.signIn();
    if (google.status === "cancelled") return { status: "cancelled" };
    if (google.status === "failed") return failed("error", GOOGLE_FAILED_MESSAGE);
    return exchange(google.idToken);
  }

  async function clearDevice(revoked: boolean): Promise<SignOutResult> {
    deps.store.signOut();
    await deps.google.signOut();
    try {
      await deps.storage.clear();
      return { revoked, cleared: true };
    } catch {
      return { revoked, cleared: false };
    }
  }

  return {
    signIn() {
      inFlight ??= run().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },

    async signOut() {
      const outcome = await deps.client.execute(signOutOperation);
      return clearDevice(outcome.status === "data" && outcome.data.signOut);
    },

    expire: () => clearDevice(false),

    async restore() {
      let token: string | null;
      try {
        token = await deps.storage.read();
      } catch {
        token = null;
      }
      if (token !== null && deps.store.getSession().status === "signedOut") {
        deps.store.signInIdentity(token);
      }
    },
  };
}
