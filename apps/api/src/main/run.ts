import type { Server } from "node:http";
import type { Config } from "../app/config";
import type { Env } from "../infra/config";
import { bootConfig } from "./boot";
import { composeApp } from "./compose";
import { createHttpServer } from "./server";

export interface RunDeps {
  readonly env: Env;
  readonly write: (line: string) => void;
  readonly writeError: (message: string) => void;
  readonly exit: (code: number) => never;
  /** Runs pending migrations as the migrator role and returns their names. */
  readonly migrate: (migratorDatabaseUrl: string) => Promise<readonly string[]>;
}

function startApi(config: Config, deps: RunDeps): Server {
  const app = composeApp({ config, write: deps.write });
  const server = createHttpServer({ graphql: app.graphql });
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

/** Boots one process. MODE picks what runs: the api server or a one shot migration. */
export async function run(deps: RunDeps): Promise<Server | null> {
  const config = bootConfig(deps);
  switch (config.mode) {
    case "api":
      return startApi(config, deps);
    case "migrate":
      return runMigrations(config, deps);
    case "worker":
      return fail(deps, `MODE=${config.mode} is not implemented yet`);
  }
}
