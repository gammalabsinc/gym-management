import { type Client, createClient } from "./api/client";
import { type AttendanceService, createAttendanceService } from "./attendance/attendance";
import { type Auth, createAuth } from "./auth/auth";
import { createGoogleSignIn, type GoogleSigninLike } from "./auth/google";
import { createSessionStore, type SessionStore } from "./auth/session-store";
import { createSecureTokenStorage, type SecureStoreLike } from "./auth/token-storage";
import type { BrightnessLike } from "./card/brightness";
import { createCardCache, type KeyValueLike } from "./card/cache";
import { createCardService } from "./card/card";
import type { CardDeps } from "./card/context";
import type { RuntimeConfig } from "./config/build-config";
import type { CustomersService } from "./customers/list";
import { createCustomersService } from "./customers/list";
import { createGyms, type Gyms } from "./gyms";
import { createProfileService, type ProfileService } from "./profile/service";
import type { CameraPort } from "./scanner/camera";
import type { ScannerDeps } from "./scanner/context";
import { createScanService } from "./scanner/scan";
import { createSettingsService, type SettingsService } from "./settings/service";
import { createStaffService, type StaffService } from "./staff/service";

/** The native pieces, passed in from the entry point so tests need no native module. */
export interface Platform {
  readonly secureStore: SecureStoreLike;
  /** The `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` constant of expo-secure-store. */
  readonly accessible: number;
  readonly google: GoogleSigninLike;
  readonly storage: KeyValueLike;
  readonly brightness: BrightnessLike;
  readonly camera: CameraPort;
}

export interface Services {
  readonly store: SessionStore;
  readonly client: Client;
  readonly auth: Auth;
  readonly gyms: Gyms;
  readonly card: CardDeps;
  readonly scanner: ScannerDeps;
  readonly customers: CustomersService;
  readonly settings: SettingsService;
  readonly staff: StaffService;
  readonly attendance: AttendanceService;
  readonly profile: ProfileService;
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
  let gyms: Gyms | null = null;
  const client = createClient({
    apiUrl: config.apiUrl,
    getToken: store.getToken,
    onUnauthenticated: () => {
      void auth?.expire();
    },
    onForbidden: () => {
      void gyms?.recheck();
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
  gyms = createGyms({ client, store });
  const cache = createCardCache(platform.storage);
  // The cached card belongs to one signed in gym. Signing out, losing access or switching gym drops it.
  store.subscribe(() => {
    if (store.getSession().status !== "signedIn") void cache.clear();
  });
  const service = createCardService({ client, cache, store, now: () => new Date() });
  return {
    store,
    client,
    auth,
    gyms,
    card: { service, brightness: platform.brightness },
    scanner: { service: createScanService({ client }), camera: platform.camera },
    customers: createCustomersService({ client }),
    settings: createSettingsService({ client }),
    staff: createStaffService({ client }),
    attendance: createAttendanceService({ client }),
    profile: createProfileService({ client }),
  };
}
