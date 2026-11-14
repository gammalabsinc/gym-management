import { describe, expect, it } from "vitest";
import { composeApp } from "./compose";

function setup() {
  const lines: string[] = [];
  const app = composeApp({ config: { logLevel: "info" }, write: (line) => lines.push(line) });
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
});
