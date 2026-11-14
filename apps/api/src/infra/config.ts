import { z } from "zod";
import { type Config, LOG_LEVELS, MODES, NODE_ENVS } from "../app/config";

export type Env = Readonly<Record<string, string | undefined>>;

const REDACTED = "[redacted]";

const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).default("development"),
    MODE: z.enum(MODES).default("api"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
    DATABASE_URL: z.url(),
    MIGRATOR_DATABASE_URL: z.url().optional(),
  })
  .transform(
    (env): Config => ({
      nodeEnv: env.NODE_ENV,
      mode: env.MODE,
      port: env.PORT,
      logLevel: env.LOG_LEVEL,
      databaseUrl: env.DATABASE_URL,
      ...(env.MIGRATOR_DATABASE_URL === undefined
        ? {}
        : { migratorDatabaseUrl: env.MIGRATOR_DATABASE_URL }),
    }),
  );

export class ConfigError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  ${p}`).join("\n")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

/**
 * Parses the environment once. Problems name the variable and the rule that failed,
 * and never repeat the offending value, so a bad secret cannot leak into a log.
 */
export function parseConfig(env: Env): Config {
  const result = envSchema.safeParse(env);
  if (result.success) return result.data;
  throw new ConfigError(
    result.error.issues.map((issue) => `${issue.path.join(".") || "(env)"}: ${issue.message}`),
  );
}

export function loadConfig(): Config {
  return parseConfig(process.env);
}

/** The only form of config that may be logged. */
export function redactConfig(config: Config): Record<string, unknown> {
  return {
    ...config,
    databaseUrl: REDACTED,
    ...(config.migratorDatabaseUrl === undefined ? {} : { migratorDatabaseUrl: REDACTED }),
  };
}
