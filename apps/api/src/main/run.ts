import type { Server } from "node:http";
import type { Config, RolePasswordsConfig } from "../app/config";
import type { Env } from "../infra/config";
import type { Database } from "../infra/db/connection";
import { bootConfig } from "./boot";
import { composeApp } from "./compose";
import type { OnboardGym } from "./onboard";
import { createHttpServer } from "./server";
import { makeShutdown } from "./shutdown";

export interface RunDeps {
  readonly env: Env;
  readonly write: (line: string) => void;
  readonly writeError: (message: string) => void;
  readonly exit: (code: number) => never;
  /** Runs pending migrations as the migrator role and returns their names. */
  readonly migrate: (migratorDatabaseUrl: string) => Promise<readonly string[]>;
  /** Creates the database roles and sets their passwords, as the administrator in the url. */
  readonly provision: (adminDatabaseUrl: string, passwords: RolePasswordsConfig) => Promise<void>;
  /** Adds a gym, as the app role in the url. */
  readonly onboard: OnboardGym;
  /** Opens the app role pool. */
  readonly connect: (databaseUrl: string) => Promise<Database>;
  /** Registers a handler for a process signal. */
  readonly onSignal: (signal: "SIGTERM" | "SIGINT", handler: () => void) => void;
}

const DRAIN_TIMEOUT_MS = 25_000;

async function startApi(config: Config, deps: RunDeps): Promise<Server> {
  const app = composeApp({ config, write: deps.write });
  const database = await deps.connect(config.databaseUrl);
  let shutdown: ReturnType<typeof makeShutdown> | undefined;
  const server = createHttpServer({
    graphql: app.graphql,
    isReady: async () => {
      if (shutdown?.draining() === true) return false;
      await database.ping();
      return true;
    },
  });
  shutdown = makeShutdown({
    server,
    close: () => database.close(),
    log: (message) => app.logger.info(message),
    exit: (code) => deps.exit(code),
    timeoutMs: DRAIN_TIMEOUT_MS,
  });
  const begin = (signal: "SIGTERM" | "SIGINT") => () => void shutdown?.begin(signal);
  deps.onSignal("SIGTERM", begin("SIGTERM"));
  deps.onSignal("SIGINT", begin("SIGINT"));
  server.listen(config.port, () => {
    app.logger.info("api listening", { port: config.port, mode: config.mode });
  });
  return server;
}

function fail(deps: RunDeps, message: string): never {
  deps.writeError(message);
  return deps.exit(1);
}

async function runMigrations(config: Config, deps: RunDeps): Promise<null> {
  if (config.migratorDatabaseUrl === undefined) {
    return fail(deps, "MIGRATOR_DATABASE_URL is required when MODE=migrate");
  }
  const ran = await deps.migrate(config.migratorDatabaseUrl);
  deps.write(JSON.stringify({ msg: "migrations finished", ran }));
  return null;
}

async function runProvision(config: Config, deps: RunDeps): Promise<null> {
  if (config.rolePasswords === undefined) {
    return fail(
      deps,
      "MIGRATOR_ROLE_PASSWORD and APP_ROLE_PASSWORD are required when MODE=provision",
    );
  }
  await deps.provision(config.databaseUrl, config.rolePasswords);
  deps.write(JSON.stringify({ msg: "roles provisioned" }));
  return null;
}

async function runOnboarding(config: Config, deps: RunDeps): Promise<null> {
  if (config.onboarding === undefined) {
    return fail(
      deps,
      "GYM_NAME, GYM_SUBDOMAIN, GYM_TIMEZONE, GYM_CURRENCY and OWNER_EMAIL are required when MODE=onboard",
    );
  }
  const result = await deps.onboard(config.databaseUrl, config.onboarding);
  if (!result.ok) {
    return fail(
      deps,
      `Invalid gym:\n${result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`,
    );
  }
  const { created, tenantId, subdomain } = result.value;
  deps.write(
    JSON.stringify({ msg: created ? "gym created" : "gym already exists", tenantId, subdomain }),
  );
  return null;
}

/** Boots one process. MODE picks what runs: the api server or a one shot migration, role setup or gym onboarding. */
export async function run(deps: RunDeps): Promise<Server | null> {
  const config = bootConfig(deps);
  switch (config.mode) {
    case "api":
      return startApi(config, deps);
    case "migrate":
      return runMigrations(config, deps);
    case "provision":
      return runProvision(config, deps);
    case "onboard":
      return runOnboarding(config, deps);
    case "worker":
      return fail(deps, `MODE=${config.mode} is not implemented yet`);
  }
}
