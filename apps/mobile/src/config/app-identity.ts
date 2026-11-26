import type { BuildProfile } from "./build-config";

export const BASE_APP_ID = "com.gammalabs.gym";
export const BASE_APP_NAME = "Gym";

export interface AppIdentity {
  /** Used as the iOS bundle identifier and the Android package. */
  readonly appId: string;
  readonly name: string;
}

/**
 * Builds of different profiles must never be confused or overwrite each other on a
 * device, so every non production profile gets its own app id suffix and name.
 */
export function appIdentity(profile: BuildProfile): AppIdentity {
  if (profile === "production") return { appId: BASE_APP_ID, name: BASE_APP_NAME };
  return { appId: `${BASE_APP_ID}.${profile}`, name: `${BASE_APP_NAME} (${profile})` };
}
