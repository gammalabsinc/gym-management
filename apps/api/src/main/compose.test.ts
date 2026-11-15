import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { composeApp } from "./compose";
import { createHttpServer } from "./server";

function setup() {
  const lines: string[] = [];
  const app = composeApp({
    config: { logLevel: "info", nodeEnv: "test" },
    write: (line) => lines.push(line),
  });
  return { app, lines };
}

describe("composeApp", () => {
  it("wires the greeting end to end with real adapters", () => {
    const { app } = setup();
    expect(app.greeting({ name: "Sam" }).message).toMatch(
      /^Good (morning|afternoon|evening), Sam$/,
    );
  });

  it("gives every line of a request the same generated request id", () => {
    const { app, lines } = setup();
    const ctx = app.requestContext({ tenantId: "t1" });
    ctx.logger.info("first");
    ctx.logger.warn("second");
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(ctx.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(parsed.map((line) => line.requestId)).toEqual([ctx.requestId, ctx.requestId]);
    expect(parsed.every((line) => line.tenantId === "t1")).toBe(true);
  });

  it("honours the configured log level", () => {
    const { app, lines } = setup();
    app.logger.debug("hidden");
    expect(lines).toEqual([]);
  });

  it("serves the health query through the real graphql handler and context", async () => {
    const { app, lines } = setup();
    const response = await app.graphql.fetch(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: { "content-type": "application/json", "x-request-id": "req-1" },
        body: JSON.stringify({ query: "{ health }" }),
      }),
    );
    expect(await response.json()).toEqual({ data: { health: "ok" } });
    expect(lines).toEqual([]);
  });

  it("serves graphql over a real socket behind the body limit, and throttles a scan flood", async () => {
    const { app } = setup();
    const server = createHttpServer({ graphql: app.graphql });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/graphql`;
    const send = (query: string) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
    try {
      expect(await (await send("{ health }")).json()).toEqual({ data: { health: "ok" } });
      const codes: (string | undefined)[] = [];
      for (let i = 0; i < 125; i += 1) {
        const body = (await (
          await send('mutation { recordScan(barcode: "b") { __typename } }')
        ).json()) as {
          errors?: { extensions?: { code?: string } }[];
        };
        codes.push(body.errors?.[0]?.extensions?.code);
      }
      expect(codes.filter((code) => code === "RATE_LIMITED").length).toBeGreaterThan(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
