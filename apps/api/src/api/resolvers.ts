import type { Resolvers } from "@gym/graphql-schema";
import type { GraphQLContext } from "./context";

/**
 * Typed against the generated resolver types, so a return type that drifts from
 * schema.graphql fails tsc. Operations are added here by the tickets that own them.
 */
export function makeResolvers(): Resolvers<GraphQLContext> {
  return {
    Query: {
      health: () => "ok",
    },
  };
}
