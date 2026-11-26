import { type Client, createClient } from "./api/client";
import { type Auth, createAuth } from "./auth/auth";
import { createGoogleSignIn, type GoogleSigninLike } from "./auth/google";
import { createSessionStore, type SessionStore } from "./auth/session-store";
import { createSecureTokenStorage, type SecureStoreLike } from "./auth/token-storage";
import type { RuntimeConfig } from "./config/build-config";

/** The native pieces, passed in from the entry point so tests need no native module. */
export interface Platform {
  readonly secureStore: SecureStoreLike;
  /** The `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` constant of expo-secure-store. */
  readonly accessible: number;
  readonly google: GoogleSigninLike;
}

export interface Services {
  readonly store: SessionStore;
  readonly client: Client;
  readonly auth: Auth;
}

export function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function composeServices(
  config: RuntimeConfig,
  platform: Platform,
  fetchImpl: typeof fetch,
): Services {
  const store = createSessionStore();
  // The client reports a dead session to auth, and auth uses the client to sign in and out.
  let auth: Auth | null = null;
  const client = createClient({
    apiUrl: config.apiUrl,
    getToken: store.getToken,
    onUnauthenticated: () => {
      void auth?.expire();
    },
    newRequestId,
    fetch: fetchImpl,
  });
  auth = createAuth({
    google: createGoogleSignIn(platform.google, config.googleClientIds),
    client,
    storage: createSecureTokenStorage({
      store: platform.secureStore,
      accessible: platform.accessible,
    }),
    store,
  });
  return { store, client, auth };
}
