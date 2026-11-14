import { createServer, type Server } from "node:http";
import { routeRequest } from "../api/health";

/** Adapts the pure router to node:http. Binds to all interfaces so a container port mapping works. */
export function createHttpServer(): Server {
  return createServer((req, res) => {
    const { status, body } = routeRequest(req.method, req.url);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
}
