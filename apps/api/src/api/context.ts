import type { RequestSession } from "../app/request-session";
import type { RequestContext, RequestContextInput } from "./request-context";

/** Who is calling. A session is an identity session until the person picks a gym. */
export type Session = RequestSession;

export type SessionResolver = (request: Request) => Promise<Session | null>;

export interface GraphQLContext {
  readonly requestId: string;
  readonly session: Session | null;
  /** Always taken from the session, never from client input. */
  readonly tenantId: string | null;
  readonly logger: RequestContext["logger"];
}

export interface ContextDeps {
  readonly resolveSession: SessionResolver;
  readonly requestContext: (input: RequestContextInput) => RequestContext;
}

const REQUEST_ID_HEADER = "x-request-id";
const AUTHORIZATION_HEADER = "authorization";

/** Reads the bearer token of a request and resolves it to a session, or to none. */
export function bearerSessionResolver(
  resolve: (authorization: string | null) => Promise<Session | null>,
): SessionResolver {
  return (request) => resolve(request.headers.get(AUTHORIZATION_HEADER));
}

export function makeContextBuilder(
  deps: ContextDeps,
): (request: Request) => Promise<GraphQLContext> {
  return async (request) => {
    const session = await deps.resolveSession(request);
    const tenantId = session?.tenantId ?? null;
    const scope = {
      ...(session?.userId == null ? {} : { userId: session.userId }),
      ...(tenantId === null ? {} : { tenantId }),
    };
    const { requestId, logger } = deps.requestContext({
      requestIdHeader: request.headers.get(REQUEST_ID_HEADER),
      ...scope,
    });
    return { requestId, session, tenantId, logger };
  };
}
