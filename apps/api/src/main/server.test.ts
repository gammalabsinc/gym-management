import type { RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpServer } from "./server";

const servers: ReturnType<typeof createHttpServer>[] = [];

const graphql: RequestListener = (_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("graphql stub");
};

async function listen(): Promise<string> {
  const server = createHttpServer({ graphql });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

describe("createHttpServer", () => {
  it("serves the health check as JSON", async () => {
    const response = await fetch(`${await listen()}/healthz`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("returns 404 for unknown paths", async () => {
    const response = await fetch(`${await listen()}/missing`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("hands the graphql path to the graphql listener, query string included", async () => {
    const response = await fetch(`${await listen()}/graphql?x=1`);
    expect(await response.text()).toBe("graphql stub");
  });

  it("copes with a request that has no url", async () => {
    const server = createHttpServer({ graphql });
    const listener = server.listeners("request")[0] as RequestListener;
    let status = 0;
    listener(
      { url: undefined, method: "GET" } as never,
      {
        writeHead: (code: number) => {
          status = code;
        },
        end: () => {},
      } as never,
    );
    expect(status).toBe(404);
  });
});
