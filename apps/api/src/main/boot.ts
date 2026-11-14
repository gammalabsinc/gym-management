import type { Config } from "../app/config";
import { ConfigError, type Env, parseConfig } from "../infra/config";

export interface BootDeps {
  readonly env: Env;
  readonly writeError: (message: string) => void;
  readonly exit: (code: number) => never;
}

/** Parses config once at boot. An invalid environment stops the process before anything starts. */
export function bootConfig(deps: BootDeps): Config {
  try {
    return parseConfig(deps.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      deps.writeError(error.message);
      return deps.exit(1);
    }
    throw error;
  }
}
