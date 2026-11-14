import { describe, expect, it } from "vitest";
import type { Logger } from "../app/ports";
import type { GraphQLContext } from "./context";
import { makeGraphqlHandler } from "./graphql";

const noop = () => {};
const logger: Logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
const context: GraphQLContext = { requestId: "r1", session: null, tenantId: null, logger };

function post(query: string) {
  return new Request("http://localhost/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
}

describe("makeGraphqlHandler", () => {
  it("serves the health query", async () => {
    const yoga = makeGraphqlHandler({ buildContext: () => context });
    const response = await yoga.fetch(post("{ health }"));
    expect(await response.json()).toEqual({ data: { health: "ok" } });
  });

  it("builds the context from the request", async () => {
    const seen: string[] = [];
    const yoga = makeGraphqlHandler({
      buildContext: (request) => {
        seen.push(request.url);
        return context;
      },
    });
    await yoga.fetch(post("{ health }"));
    expect(seen).toEqual(["http://localhost/graphql"]);
  });

  it("rejects a query that is not in the schema", async () => {
    const yoga = makeGraphqlHandler({ buildContext: () => context });
    const response = await yoga.fetch(post("{ nope }"));
    const body = (await response.json()) as { errors?: unknown[] };
    expect(body.errors).toHaveLength(1);
  });

  it("does not serve the GraphiQL page", async () => {
    const yoga = makeGraphqlHandler({ buildContext: () => context });
    const response = await yoga.fetch(
      new Request("http://localhost/graphql", { headers: { accept: "text/html" } }),
    );
    expect(response.headers.get("content-type") ?? "").not.toContain("text/html");
  });
});
