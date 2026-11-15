import { typeDefs } from "@gym/graphql-schema";
import {
  type DocumentNode,
  GraphQLError,
  getOperationAST,
  Kind,
  type SelectionSetNode,
} from "graphql";
import { createSchema, createYoga, type Plugin } from "graphql-yoga";
import type { RateLimiter } from "../app/rate-limit";
import type { GraphQLContext } from "./context";
import {
  DEFAULT_QUERY_LIMITS,
  noIntrospectionRule,
  type QueryLimits,
  queryLimitsRule,
} from "./limits";
import { makeResolvers } from "./resolvers";

export const GRAPHQL_PATH = "/graphql";

export interface GraphqlDeps {
  readonly buildContext: (request: Request) => GraphQLContext;
  /** Introspection is refused when this is true. */
  readonly production?: boolean;
  readonly limits?: QueryLimits;
  /** One limiter per root field, applied per client address. */
  readonly rateLimits?: Readonly<Record<string, RateLimiter>>;
}

interface NodeServerContext {
  readonly req?: { readonly socket?: { readonly remoteAddress?: string | undefined } };
}

/** The address of the TCP peer. Forwarding headers are not trusted, a client could set them. */
export function clientAddress(serverContext: NodeServerContext): string {
  return serverContext.req?.socket?.remoteAddress ?? "unknown";
}

function collectRootFields(
  selections: SelectionSetNode,
  document: DocumentNode,
  seen: Set<string>,
  into: Set<string>,
): void {
  for (const selection of selections.selections) {
    if (selection.kind === Kind.FIELD) {
      into.add(selection.name.value);
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      collectRootFields(selection.selectionSet, document, seen, into);
    } else if (!seen.has(selection.name.value)) {
      seen.add(selection.name.value);
      for (const definition of document.definitions) {
        if (
          definition.kind === Kind.FRAGMENT_DEFINITION &&
          definition.name.value === selection.name.value
        ) {
          collectRootFields(definition.selectionSet, document, seen, into);
        }
      }
    }
  }
}

export function rootFieldNames(document: DocumentNode, operationName?: string | null): string[] {
  const operation = getOperationAST(document, operationName);
  if (operation === null || operation === undefined) return [];
  const into = new Set<string>();
  collectRootFields(operation.selectionSet, document, new Set(), into);
  return [...into];
}

function rateLimitPlugin(
  limiters: Readonly<Record<string, RateLimiter>>,
): Plugin<NodeServerContext> {
  return {
    onExecute({ args, setResultAndStopExecution }) {
      const address = clientAddress(args.contextValue as NodeServerContext);
      for (const field of rootFieldNames(args.document, args.operationName)) {
        const limiter = limiters[field];
        if (limiter === undefined) continue;
        const decision = limiter.take(`${field}:${address}`);
        if (!decision.allowed) {
          setResultAndStopExecution({
            errors: [
              new GraphQLError("Too many requests, try again later", {
                extensions: { code: "RATE_LIMITED", retryAfterSeconds: decision.retryAfterSeconds },
              }),
            ],
          });
          return;
        }
      }
    },
  };
}

/** The GraphQL endpoint as a node:http listener. Errors are masked before they reach a client. */
export function makeGraphqlHandler(deps: GraphqlDeps) {
  const rules = [
    queryLimitsRule(deps.limits ?? DEFAULT_QUERY_LIMITS),
    ...(deps.production === true ? [noIntrospectionRule] : []),
  ];
  const plugins: Plugin<NodeServerContext>[] = [
    { onValidate: ({ addValidationRule }) => rules.forEach(addValidationRule) },
    ...(deps.rateLimits === undefined ? [] : [rateLimitPlugin(deps.rateLimits)]),
  ];
  return createYoga<NodeServerContext, GraphQLContext>({
    schema: createSchema<GraphQLContext>({ typeDefs, resolvers: makeResolvers() }),
    context: ({ request }) => deps.buildContext(request),
    plugins,
    graphqlEndpoint: GRAPHQL_PATH,
    landingPage: false,
    graphiql: false,
    logging: false,
    maskedErrors: true,
  });
}
