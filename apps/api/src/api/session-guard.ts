import { forbidden, unauthenticated } from "../domain/errors";
import type { GraphQLContext } from "./context";
import { toGraphQLError } from "./mappers";

export function requireSession(ctx: GraphQLContext) {
  if (ctx.session === null) throw toGraphQLError(unauthenticated().error);
  return ctx.session;
}

/** The caller inside a gym. Roles, user and gym all come from the session, never from the request. */
export function requireGym(ctx: GraphQLContext) {
  const session = requireSession(ctx);
  if (session.tenantId === null || session.userId === null) {
    throw toGraphQLError(forbidden("Pick a gym first").error);
  }
  return {
    tenantId: session.tenantId,
    userId: session.userId,
    roles: session.roles,
    requestId: ctx.requestId,
  };
}
