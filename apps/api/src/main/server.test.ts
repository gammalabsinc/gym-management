import { type RequestListener, request } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpServer, DEFAULT_MAX_BODY_BYTES } from "./server";

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

describe("body size limit", () => {
  async function listenWithEcho(maxBodyBytes: number): Promise<{ url: string; port: number }> {
    const echo: RequestListener = (req, res) => {
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
      });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(String(size));
      });
    };
    const server = createHttpServer({ graphql: echo, maxBodyBytes });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    return { url: `http://127.0.0.1:${port}/graphql`, port };
  }

  it("passes a body within the limit", async () => {
    const { url } = await listenWithEcho(100);
    const response = await fetch(url, { method: "POST", body: "x".repeat(100) });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("100");
  });

  it("answers 413 when the declared length is over the limit", async () => {
    const { url } = await listenWithEcho(100);
    const response = await fetch(url, { method: "POST", body: "x".repeat(101) });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "payload_too_large" });
  });

  it("answers 413 to a chunked body that grows past the limit", async () => {
    const { port } = await listenWithEcho(100);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ port, host: "127.0.0.1", path: "/graphql", method: "POST" }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.write("x".repeat(60));
      req.write("x".repeat(60));
      req.end();
    });
    expect(status).toBe(413);
  });

  it("uses the default limit when none is given", () => {
    expect(DEFAULT_MAX_BODY_BYTES).toBe(100_000);
  });
});

describe("readiness", () => {
  async function listenReady(isReady?: () => Promise<boolean>): Promise<string> {
    const server = createHttpServer({ graphql, ...(isReady === undefined ? {} : { isReady }) });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/readyz`;
  }

  it("is ready when no probe is configured", async () => {
    const response = await fetch(await listenReady());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
  });

  it("is ready when the probe says so", async () => {
    expect((await fetch(await listenReady(async () => true))).status).toBe(200);
  });

  it("is not ready when the probe says no, or throws", async () => {
    expect((await fetch(await listenReady(async () => false))).status).toBe(503);
    const failing = await fetch(
      await listenReady(async () => {
        throw new Error("db down");
      }),
    );
    expect(failing.status).toBe(503);
    expect(await failing.json()).toEqual({ status: "not_ready" });
  });

  it("only answers GET", async () => {
    const response = await fetch(await listenReady(), { method: "POST" });
    expect(response.status).toBe(404);
  });
});
