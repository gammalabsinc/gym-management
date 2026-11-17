import { z } from "zod";
import { type Config, LOG_LEVELS, MODES, NODE_ENVS } from "../app/config";
import type { OnboardGymInput } from "../domain/onboarding";
import { MAX_FEE } from "../domain/plans";

export type Env = Readonly<Record<string, string | undefined>>;

const REDACTED = "[redacted]";
const MIN_PASSWORD_LENGTH = 16;

interface OnboardingEnv {
  readonly GYM_NAME?: string | undefined;
  readonly GYM_SUBDOMAIN?: string | undefined;
  readonly GYM_TIMEZONE?: string | undefined;
  readonly GYM_CURRENCY?: string | undefined;
  readonly OWNER_EMAIL?: string | undefined;
  readonly OWNER_NAME?: string | undefined;
  readonly ADMISSION_FEE?: number | undefined;
  readonly MONTHLY_FEE?: number | undefined;
}

/** The onboarding input, or nothing at all unless every required variable is set. The fees default to zero. */
function onboardingFrom(env: OnboardingEnv): { readonly onboarding?: OnboardGymInput } {
  const { GYM_NAME, GYM_SUBDOMAIN, GYM_TIMEZONE, GYM_CURRENCY, OWNER_EMAIL } = env;
  if (
    GYM_NAME === undefined ||
    GYM_SUBDOMAIN === undefined ||
    GYM_TIMEZONE === undefined ||
    GYM_CURRENCY === undefined ||
    OWNER_EMAIL === undefined
  ) {
    return {};
  }
  return {
    onboarding: {
      name: GYM_NAME,
      subdomain: GYM_SUBDOMAIN,
      timezone: GYM_TIMEZONE,
      currency: GYM_CURRENCY,
      ownerEmail: OWNER_EMAIL,
      ownerName: env.OWNER_NAME,
      admissionFee: env.ADMISSION_FEE ?? 0,
      monthlyFee: env.MONTHLY_FEE ?? 0,
    },
  };
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).default("development"),
    MODE: z.enum(MODES).default("api"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
    DATABASE_URL: z.url(),
    MIGRATOR_DATABASE_URL: z.url().optional(),
    MIGRATOR_ROLE_PASSWORD: z.string().min(MIN_PASSWORD_LENGTH).optional(),
    APP_ROLE_PASSWORD: z.string().min(MIN_PASSWORD_LENGTH).optional(),
    GYM_NAME: z.string().optional(),
    GYM_SUBDOMAIN: z.string().optional(),
    GYM_TIMEZONE: z.string().optional(),
    GYM_CURRENCY: z.string().optional(),
    OWNER_EMAIL: z.string().optional(),
    OWNER_NAME: z.string().optional(),
    ADMISSION_FEE: z.coerce.number().int().min(0).max(MAX_FEE).optional(),
    MONTHLY_FEE: z.coerce.number().int().min(0).max(MAX_FEE).optional(),
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
      ...(env.MIGRATOR_ROLE_PASSWORD === undefined || env.APP_ROLE_PASSWORD === undefined
        ? {}
        : {
            rolePasswords: {
              migratorPassword: env.MIGRATOR_ROLE_PASSWORD,
              appPassword: env.APP_ROLE_PASSWORD,
            },
          }),
      ...onboardingFrom(env),
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
    ...(config.rolePasswords === undefined ? {} : { rolePasswords: REDACTED }),
    ...(config.onboarding === undefined ? {} : { onboarding: REDACTED }),
  };
}
