import type { Server } from "node:http";
import type { Env } from "../infra/config";
import { bootConfig } from "./boot";
import { composeApp } from "./compose";
import { createHttpServer } from "./server";

export interface RunDeps {
  readonly env: Env;
  readonly write: (line: string) => void;
  readonly writeError: (message: string) => void;
  readonly exit: (code: number) => never;
}

/** Boots one process. MODE picks what runs; only the api mode exists so far. */
export function run(deps: RunDeps): Server {
  const config = bootConfig(deps);
  if (config.mode !== "api") {
    deps.writeError(`MODE=${config.mode} is not implemented yet`);
    return deps.exit(1);
  }
  const app = composeApp({ config, write: deps.write });
  const server = createHttpServer({ graphql: app.graphql });
  server.listen(config.port, () => {
    app.logger.info("api listening", { port: config.port, mode: config.mode });
  });
  return server;
}
