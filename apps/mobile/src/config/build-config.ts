export const APP_ENVS = ["development", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/** The only configuration the app bundle carries. It holds no secrets. */
export interface RuntimeConfig {
  readonly appEnv: AppEnv;
  readonly apiUrl: string;
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

function parseAppEnv(value: string | undefined): AppEnv | null {
  if (value === undefined || value === "") return "development";
  return APP_ENVS.find((candidate) => candidate === value) ?? null;
}

function parseApiUrl(value: string | undefined, appEnv: AppEnv): string | string[] {
  if (value === undefined || value === "") return ["API_URL: is required"];
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return ["API_URL: must be an absolute URL"];
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return ["API_URL: must start with http:// or https://"];
  }
  if (appEnv !== "development" && url.protocol !== "https:") {
    return [`API_URL: must use https for ${appEnv}`];
  }
  return value.replace(/\/+$/, "");
}

/**
 * Parses the build environment once. Problems name the variable and the rule,
 * and never repeat the value, so a mistyped URL cannot leak into a log.
 */
export function parseBuildEnv(env: BuildEnv): RuntimeConfig {
  const appEnv = parseAppEnv(env.APP_ENV);
  if (appEnv === null) {
    throw new ConfigError([`APP_ENV: must be one of ${APP_ENVS.join(", ")}`]);
  }
  const apiUrl = parseApiUrl(env.API_URL, appEnv);
  if (typeof apiUrl !== "string") throw new ConfigError(apiUrl);
  return { appEnv, apiUrl };
}
