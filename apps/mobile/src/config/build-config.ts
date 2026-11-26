/**
 * `development` is for local work only. `internal` and `production` are the two
 * build service profiles, and both talk to the production API.
 */
export const BUILD_PROFILES = ["development", "internal", "production"] as const;
export type BuildProfile = (typeof BUILD_PROFILES)[number];

/** Google OAuth client ids are public identifiers, not secrets, but they still come from the build environment. */
export interface GoogleClientIds {
  readonly ios: string;
  readonly android: string;
}

/** The only configuration the app bundle carries. It holds no secrets. */
export interface RuntimeConfig {
  readonly profile: BuildProfile;
  readonly apiUrl: string;
  /** Null only in the development profile, where Google sign in is not wired up. */
  readonly googleClientIds: GoogleClientIds | null;
}

export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid app configuration:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

export type BuildEnv = Readonly<Record<string, string | undefined>>;

const GOOGLE_CLIENT_ID_SUFFIX = ".apps.googleusercontent.com";

type Parsed<T> = { readonly value: T } | { readonly problems: readonly string[] };

function isMissing(value: string | undefined): value is undefined {
  return value === undefined || value === "";
}

function parseProfile(value: string | undefined): Parsed<BuildProfile> {
  if (isMissing(value)) return { value: "development" };
  const profile = BUILD_PROFILES.find((candidate) => candidate === value);
  if (profile === undefined) {
    return { problems: [`BUILD_PROFILE: must be one of ${BUILD_PROFILES.join(", ")}`] };
  }
  return { value: profile };
}

function parseApiUrl(value: string | undefined, profile: BuildProfile): Parsed<string> {
  if (isMissing(value)) return { problems: ["API_URL: is required"] };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { problems: ["API_URL: must be an absolute URL"] };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { problems: ["API_URL: must start with http:// or https://"] };
  }
  if (profile !== "development" && url.protocol !== "https:") {
    return { problems: [`API_URL: must use https for ${profile}`] };
  }
  return { value: value.replace(/\/+$/, "") };
}

function parseGoogleClientId(name: string, value: string | undefined): Parsed<string> {
  if (isMissing(value)) return { problems: [`${name}: is required`] };
  if (!value.endsWith(GOOGLE_CLIENT_ID_SUFFIX)) {
    return {
      problems: [`${name}: must be a Google client id ending in ${GOOGLE_CLIENT_ID_SUFFIX}`],
    };
  }
  return { value };
}

function parseGoogleClientIds(env: BuildEnv): Parsed<GoogleClientIds> {
  const ios = parseGoogleClientId("GOOGLE_IOS_CLIENT_ID", env.GOOGLE_IOS_CLIENT_ID);
  const android = parseGoogleClientId("GOOGLE_ANDROID_CLIENT_ID", env.GOOGLE_ANDROID_CLIENT_ID);
  if ("value" in ios && "value" in android) {
    return { value: { ios: ios.value, android: android.value } };
  }
  return {
    problems: [
      ...("problems" in ios ? ios.problems : []),
      ...("problems" in android ? android.problems : []),
    ],
  };
}

/**
 * Parses the build environment once and reports every problem together. Problems name
 * the variable and the rule, and never repeat the value, so a mistyped value cannot
 * leak into a log.
 */
export function parseBuildEnv(env: BuildEnv): RuntimeConfig {
  const profile = parseProfile(env.BUILD_PROFILE);
  if ("problems" in profile) throw new ConfigError(profile.problems);

  const apiUrl = parseApiUrl(env.API_URL, profile.value);
  const googleClientIds =
    profile.value === "development" ? ({ value: null } as const) : parseGoogleClientIds(env);

  const problems = [
    ...("problems" in apiUrl ? apiUrl.problems : []),
    ...("problems" in googleClientIds ? googleClientIds.problems : []),
  ];
  if ("problems" in apiUrl || "problems" in googleClientIds) throw new ConfigError(problems);

  return { profile: profile.value, apiUrl: apiUrl.value, googleClientIds: googleClientIds.value };
}
