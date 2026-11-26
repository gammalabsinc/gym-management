import { ConfigError, parseBuildEnv, type RuntimeConfig } from "./build-config";

/** The part of expo-constants the app reads. Passed in so tests need no native module. */
export interface ConstantsLike {
  readonly expoConfig?: { readonly extra?: Readonly<Record<string, unknown>> | undefined } | null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Reads the config that app.config.ts baked in at build time and validates it again. */
export function loadRuntimeConfig(constants: ConstantsLike): RuntimeConfig {
  const extra = constants.expoConfig?.extra;
  if (extra === undefined) throw new ConfigError(["extra: missing from the app config"]);
  return parseBuildEnv({
    BUILD_PROFILE: text(extra.profile),
    API_URL: text(extra.apiUrl),
    GOOGLE_IOS_CLIENT_ID: text(extra.googleIosClientId),
    GOOGLE_ANDROID_CLIENT_ID: text(extra.googleAndroidClientId),
  });
}
