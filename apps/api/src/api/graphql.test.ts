import { parse } from "graphql";
import { describe, expect, it } from "vitest";
import type { Logger } from "../app/ports";
import { makeRateLimiter } from "../app/rate-limit";
import type { GraphQLContext } from "./context";
import { clientAddress, makeGraphqlHandler, rootFieldNames } from "./graphql";

const noop = () => {};
const logger: Logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
const context: GraphQLContext = {
  requestId: "r1",
  session: null,
  token: null,
  tenantId: null,
  logger,
};

function post(query: string) {
  return new Request("http://localhost/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
}

describe("makeGraphqlHandler", () => {
  it("serves the health query", async () => {
    const yoga = makeGraphqlHandler({ buildContext: async () => context });
    const response = await yoga.fetch(post("{ health }"));
    expect(await response.json()).toEqual({ data: { health: "ok" } });
  });

  it("builds the context from the request", async () => {
    const seen: string[] = [];
    const yoga = makeGraphqlHandler({
      buildContext: async (request) => {
        seen.push(request.url);
        return context;
      },
    });
    await yoga.fetch(post("{ health }"));
    expect(seen).toEqual(["http://localhost/graphql"]);
  });

  it("rejects a query that is not in the schema", async () => {
    const yoga = makeGraphqlHandler({ buildContext: async () => context });
    const response = await yoga.fetch(post("{ nope }"));
    const body = (await response.json()) as { errors?: unknown[] };
    expect(body.errors).toHaveLength(1);
  });

  it("does not serve the GraphiQL page", async () => {
    const yoga = makeGraphqlHandler({ buildContext: async () => context });
    const response = await yoga.fetch(
      new Request("http://localhost/graphql", { headers: { accept: "text/html" } }),
    );
    expect(response.headers.get("content-type") ?? "").not.toContain("text/html");
  });
});

const nested = (depth: number) =>
  `{ ${"a: health ".repeat(1)}${Array.from({ length: depth }, () => "x {").join(" ")} ${"}".repeat(depth)} }`;

async function bodyOf(response: Response) {
  return (await response.json()) as {
    data?: unknown;
    errors?: { extensions?: { code?: string } }[];
  };
}

describe("hardening", () => {
  it("rejects a deeply nested query before it runs", async () => {
    const yoga = makeGraphqlHandler({ buildContext: async () => context });
    const body = await bodyOf(await yoga.fetch(post(nested(30))));
    expect(body.errors?.[0]?.extensions?.code).toBe("QUERY_TOO_DEEP");
  });

  it("allows introspection outside production", async () => {
    const yoga = makeGraphqlHandler({ buildContext: async () => context });
    const body = await bodyOf(await yoga.fetch(post("{ __schema { queryType { name } } }")));
    expect(body.data).toEqual({ __schema: { queryType: { name: "Query" } } });
  });

  it("refuses introspection in production", async () => {
    const yoga = makeGraphqlHandler({ buildContext: async () => context, production: true });
    const body = await bodyOf(await yoga.fetch(post("{ __schema { queryType { name } } }")));
    expect(body.errors?.[0]?.extensions?.code).toBe("INTROSPECTION_DISABLED");
  });

  it("throttles a flood on a limited root field, per client address", async () => {
    const limiter = makeRateLimiter({
      clock: { now: () => new Date(0) },
      policy: { limit: 2, windowMs: 60_000 },
    });
    const yoga = makeGraphqlHandler({
      buildContext: async () => context,
      rateLimits: { health: limiter },
    });
    const from = (address: string) =>
      yoga.fetch(post("query Q { ...F } fragment F on Query { health }"), {
        req: { socket: { remoteAddress: address } },
      });
    expect((await bodyOf(await from("1.1.1.1"))).data).toEqual({ health: "ok" });
    expect((await bodyOf(await from("1.1.1.1"))).data).toEqual({ health: "ok" });
    const blocked = await bodyOf(await from("1.1.1.1"));
    expect(blocked.errors?.[0]?.extensions?.code).toBe("RATE_LIMITED");
    expect((await bodyOf(await from("2.2.2.2"))).data).toEqual({ health: "ok" });
  });

  it("keys unknown peers together and ignores fields without a limiter", async () => {
    const limiter = makeRateLimiter({
      clock: { now: () => new Date(0) },
      policy: { limit: 1, windowMs: 60_000 },
    });
    const yoga = makeGraphqlHandler({
      buildContext: async () => context,
      rateLimits: { other: limiter },
    });
    expect((await bodyOf(await yoga.fetch(post("{ health }")))).data).toEqual({ health: "ok" });
    expect((await bodyOf(await yoga.fetch(post("{ health }")))).data).toEqual({ health: "ok" });
    expect(clientAddress({})).toBe("unknown");
  });

  it("finds root fields through fragments and skips unnamed operations it cannot pick", () => {
    const doc = parse("{ a ... { b } ...F ...F } fragment F on Query { c }");
    expect(rootFieldNames(doc)).toEqual(["a", "b", "c"]);
    expect(rootFieldNames(parse("query A { a } query B { b }"))).toEqual([]);
  });
});
