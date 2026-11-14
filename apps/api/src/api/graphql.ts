import { typeDefs } from "@gym/graphql-schema";
import { createSchema, createYoga } from "graphql-yoga";
import type { GraphQLContext } from "./context";
import { makeResolvers } from "./resolvers";

export const GRAPHQL_PATH = "/graphql";

export interface GraphqlDeps {
  readonly buildContext: (request: Request) => GraphQLContext;
}

/** The GraphQL endpoint as a node:http listener. Errors are masked before they reach a client. */
export function makeGraphqlHandler(deps: GraphqlDeps) {
  return createYoga<object, GraphQLContext>({
    schema: createSchema<GraphQLContext>({ typeDefs, resolvers: makeResolvers() }),
    context: ({ request }) => deps.buildContext(request),
    graphqlEndpoint: GRAPHQL_PATH,
    landingPage: false,
    graphiql: false,
    logging: false,
    maskedErrors: true,
  });
}
