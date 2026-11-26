import { bearerSessionResolver, makeContextBuilder } from "../api/context";
import { makeGraphqlHandler } from "../api/graphql";
import { makeGreetingResolver } from "../api/greeting";
import { makeRequestContextBuilder } from "../api/request-context";
import type { ResolverDeps } from "../api/resolvers";
import type { Config } from "../app/config";
import { makeEnterGym } from "../app/enter-gym";
import type { VerifyGoogleIdToken } from "../app/google-sign-in";
import { makeGreet } from "../app/greet";
import { makeFindMembership } from "../app/gym-membership";
import { makeListMyGyms } from "../app/gym-picker";
import { makeRateLimiter } from "../app/rate-limit";
import { makeResolveRequestSession } from "../app/request-session";
import { makeSelectGym } from "../app/select-gym";
import { makeSessions } from "../app/sessions";
import { makeSignIn } from "../app/sign-in";
import { makeGetTenant } from "../app/tenant-settings";
import { makeWhoAmI } from "../app/who-am-i";
import { systemClock } from "../infra/clock";
import type { Database } from "../infra/db/connection";
import { makeAccountDirectory, makeAccountLookup } from "../infra/google/accounts-sql";
import { makeGoogleIdTokenVerifier } from "../infra/google/verify-id-token";
import { uuidGenerator } from "../infra/ids";
import { makeLogger } from "../infra/logger";
import { expiresAfter } from "../infra/sessions/session-lifetime";
import { sessionTokens } from "../infra/sessions/session-tokens";
import { makeSessionStore } from "../infra/sessions/sessions-sql";
import { makeWithGymPickerUnit } from "../infra/tenants/gym-picker-unit";
import { makeGymRegistry } from "../infra/tenants/gym-registry-sql";
import { makeWithSettingsUnit } from "../infra/tenants/settings-unit";
import { makeWithWhoAmIUnit } from "../infra/tenants/who-am-i-unit";

export interface ComposeDeps {
  readonly config: Pick<Config, "logLevel" | "nodeEnv" | "googleClientIds" | "sessionDays">;
  /** The connected app role pool. Everything that touches data goes through it. */
  readonly database: Pick<Database, "transact" | "withTenantTx">;
  /** Where finished log lines go. The server entry point passes stdout. */
  readonly write: (line: string) => void;
  /** Replaces the Google verifier. Tests pass a fake, the server entry point leaves it out. */
  readonly verifyGoogleIdToken?: VerifyGoogleIdToken;
}

const DAY_MS = 86_400_000;
const GOOGLE_LEEWAY_SECONDS = 60;

/** Composition root: the only place that calls factories with real adapters. */
export function composeApp(deps: ComposeDeps) {
  const logger = makeLogger({ clock: systemClock, write: deps.write, level: deps.config.logLevel });
  const greet = makeGreet({ clock: systemClock });
  const requestContext = makeRequestContextBuilder({ ids: uuidGenerator, logger });
  const { transact, withTenantTx } = deps.database;

  // Sessions and gyms are not scoped to one gym, so each statement runs in its own transaction.
  const unscoped = {
    query: (sql: string, params: unknown[]) => transact((e) => e.query(sql, params)),
  };
  const sessionStore = makeSessionStore(unscoped);
  const sessions = makeSessions({
    store: sessionStore,
    tokens: sessionTokens,
    clock: systemClock,
    ids: uuidGenerator,
    expiryFor: expiresAfter(deps.config.sessionDays * DAY_MS),
  });
  const accounts = makeAccountDirectory(transact);
  const lookup = makeAccountLookup(transact);
  const withGymPickerUnit = makeWithGymPickerUnit(withTenantTx);
  const findMembership = makeFindMembership({ accounts: lookup, withUnit: withGymPickerUnit });
  const listMyGyms = makeListMyGyms({ accounts: lookup, withUnit: withGymPickerUnit });
  const selectGym = makeSelectGym({
    gyms: makeGymRegistry(unscoped),
    findMembership,
    sessions: sessionStore,
  });
  const verify =
    deps.verifyGoogleIdToken ??
    makeGoogleIdTokenVerifier({
      fetch: (url) => fetch(url),
      nowMs: () => Date.now(),
      policy: { audiences: deps.config.googleClientIds, leewaySeconds: GOOGLE_LEEWAY_SECONDS },
      onReject: (reason) => logger.warn("google token rejected", { reason }),
    });
  const withSettingsUnit = makeWithSettingsUnit(withTenantTx, {
    clock: systemClock,
    ids: uuidGenerator,
  });
  const resolvers: ResolverDeps = {
    signIn: makeSignIn({ google: { verify, accounts }, sessions, listMyGyms }),
    signOut: (token) => sessions.signOut(token),
    listMyGyms,
    whoAmI: makeWhoAmI({ withUnit: makeWithWhoAmIUnit(withTenantTx) }),
    enterGym: makeEnterGym({
      selectGym,
      findMembership,
      whoAmI: makeWhoAmI({ withUnit: makeWithWhoAmIUnit(withTenantTx) }),
      getTenant: makeGetTenant({ withUnit: withSettingsUnit }),
      newRequestId: () => uuidGenerator.next(),
    }),
  };
  const resolveSession = bearerSessionResolver(
    makeResolveRequestSession({ sessions, findMembership }),
  );
  const buildContext = makeContextBuilder({ resolveSession, requestContext });
  return {
    logger,
    greeting: makeGreetingResolver(greet),
    requestContext,
    graphql: makeGraphqlHandler({
      buildContext,
      production: deps.config.nodeEnv === "production",
      resolvers,
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
