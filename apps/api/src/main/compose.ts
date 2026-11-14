import { makeGreetingResolver } from "../api/greeting";
import { makeRequestContextBuilder } from "../api/request-context";
import type { Config } from "../app/config";
import { makeGreet } from "../app/greet";
import { systemClock } from "../infra/clock";
import { uuidGenerator } from "../infra/ids";
import { makeLogger } from "../infra/logger";

export interface ComposeDeps {
  readonly config: Pick<Config, "logLevel">;
  /** Where finished log lines go. The server entry point passes stdout. */
  readonly write: (line: string) => void;
}

/** Composition root: the only place that calls factories with real adapters. */
export function composeApp(deps: ComposeDeps) {
  const logger = makeLogger({ clock: systemClock, write: deps.write, level: deps.config.logLevel });
  const greet = makeGreet({ clock: systemClock });
  return {
    logger,
    greeting: makeGreetingResolver(greet),
    requestContext: makeRequestContextBuilder({ ids: uuidGenerator, logger }),
  };
}
