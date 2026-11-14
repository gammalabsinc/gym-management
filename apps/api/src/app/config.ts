export const MODES = ["api", "worker", "migrate"] as const;
export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export const NODE_ENVS = ["development", "test", "production"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Config {
  readonly nodeEnv: (typeof NODE_ENVS)[number];
  readonly mode: (typeof MODES)[number];
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly databaseUrl: string;
}
