import { createServer, type RequestListener, type Server } from "node:http";
import { GRAPHQL_PATH } from "../api/graphql";
import { routeRequest } from "../api/health";

export interface ServerDeps {
  readonly graphql: RequestListener;
}

function pathOf(url: string | undefined): string {
  return (url ?? "").split("?")[0] ?? "";
}

/** Adapts the pure router to node:http. Binds to all interfaces so a container port mapping works. */
export function createHttpServer(deps: ServerDeps): Server {
  return createServer((req, res) => {
    if (pathOf(req.url) === GRAPHQL_PATH) return deps.graphql(req, res);
    const { status, body } = routeRequest(req.method, req.url);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
}
