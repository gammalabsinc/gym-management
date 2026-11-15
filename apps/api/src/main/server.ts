import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from "node:http";
import { GRAPHQL_PATH } from "../api/graphql";
import { routeRequest } from "../api/health";

export const DEFAULT_MAX_BODY_BYTES = 100_000;

export interface ServerDeps {
  readonly graphql: RequestListener;
  readonly maxBodyBytes?: number;
}

function pathOf(url: string | undefined): string {
  return (url ?? "").split("?")[0] ?? "";
}

function tooLarge(res: ServerResponse): void {
  res.writeHead(413, { "content-type": "application/json", connection: "close" });
  res.end(JSON.stringify({ error: "payload_too_large" }));
}

/**
 * Refuses a body over the limit, by its declared length first and by the bytes actually
 * received otherwise, so a chunked upload cannot skip the check.
 */
function limitBody(req: IncomingMessage, res: ServerResponse, max: number): boolean {
  if (Number(req.headers["content-length"] ?? 0) > max) {
    tooLarge(res);
    req.destroy();
    return false;
  }
  let received = 0;
  req.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > max && !res.headersSent) {
      tooLarge(res);
      req.destroy();
    }
  });
  return true;
}

/** Adapts the pure router to node:http. Binds to all interfaces so a container port mapping works. */
export function createHttpServer(deps: ServerDeps): Server {
  const maxBodyBytes = deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  return createServer((req, res) => {
    if (pathOf(req.url) === GRAPHQL_PATH) {
      if (!limitBody(req, res, maxBodyBytes)) return;
      return deps.graphql(req, res);
    }
    const { status, body } = routeRequest(req.method, req.url);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
}
