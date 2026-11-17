import { makeContextBuilder, type SessionResolver } from "../api/context";
import { makeGraphqlHandler } from "../api/graphql";
import { makeGreetingResolver } from "../api/greeting";
import { makeRequestContextBuilder } from "../api/request-context";
import type { Config } from "../app/config";
import { makeGreet } from "../app/greet";
import { makeRateLimiter } from "../app/rate-limit";
import { systemClock } from "../infra/clock";
import { uuidGenerator } from "../infra/ids";
import { makeLogger } from "../infra/logger";

export interface ComposeDeps {
  readonly config: Pick<Config, "logLevel" | "nodeEnv">;
  /** Where finished log lines go. The server entry point passes stdout. */
  readonly write: (line: string) => void;
}

/** Nobody can sign in yet, so every request is anonymous. The session ticket replaces this. */
const anonymousSessions: SessionResolver = async () => null;

/** Composition root: the only place that calls factories with real adapters. */
export function composeApp(deps: ComposeDeps) {
  const logger = makeLogger({ clock: systemClock, write: deps.write, level: deps.config.logLevel });
  const greet = makeGreet({ clock: systemClock });
  const requestContext = makeRequestContextBuilder({ ids: uuidGenerator, logger });
  const buildContext = makeContextBuilder({ resolveSession: anonymousSessions, requestContext });
  return {
    logger,
    greeting: makeGreetingResolver(greet),
    requestContext,
    graphql: makeGraphqlHandler({
      buildContext,
      production: deps.config.nodeEnv === "production",
      rateLimits: {
        signIn: makeRateLimiter({ clock: systemClock, policy: { limit: 10, windowMs: 60_000 } }),
        recordScan: makeRateLimiter({
          clock: systemClock,
          policy: { limit: 120, windowMs: 60_000 },
        }),
      },
    }),
  };
}
