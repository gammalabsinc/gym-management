export const MODES = ["api", "worker", "migrate", "provision"] as const;
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export const NODE_ENVS = ["development", "test", "production"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  readonly nodeEnv: (typeof NODE_ENVS)[number];
  readonly mode: (typeof MODES)[number];
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly databaseUrl: string;
  /** Only the migrate mode needs it. The app role in databaseUrl cannot change the schema. */
  readonly migratorDatabaseUrl?: string;
  /**
   * Only the provision mode needs them. It sets these passwords on the two database roles, and
   * databaseUrl must then be an administrator url, not the app role.
   */
  readonly rolePasswords?: RolePasswordsConfig;
}

export interface RolePasswordsConfig {
  readonly migratorPassword: string;
  readonly appPassword: string;
}
