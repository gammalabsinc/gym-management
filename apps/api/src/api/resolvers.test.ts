import type { Resolvers } from "@gym/graphql-schema";
import { describe, expect, it } from "vitest";
import type { GraphQLContext } from "./context";
import { makeResolvers } from "./resolvers";

describe("makeResolvers", () => {
  it("answers the health query", () => {
    const health = makeResolvers().Query?.health;
    expect(typeof health).toBe("function");
    expect((health as () => string)()).toBe("ok");
  });
});

// Type level check for the done-when: a resolver that drifts from the schema must not compile.
// If the expected error ever disappears, tsc fails on the unused directive.
const drifted: Resolvers<GraphQLContext> = {
  Query: {
    // @ts-expect-error health is String!, so a number is a schema drift
    health: () => 42,
  },
};

it("keeps the drift check in the type checker's view", () => {
  expect(drifted.Query).toBeDefined();
});
