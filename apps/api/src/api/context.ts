import type { RequestContext, RequestContextInput } from "./request-context";

/** Who is calling. Sessions are issued by the auth tickets; until then nobody is signed in. */
export interface Session {
  readonly userId: string;
  /** Null for an identity session, which has not selected a gym yet. */
  readonly tenantId: string | null;
}

export type SessionResolver = (request: Request) => Session | null;

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

export function makeContextBuilder(deps: ContextDeps): (request: Request) => GraphQLContext {
  return (request) => {
    const session = deps.resolveSession(request);
    const tenantId = session?.tenantId ?? null;
    const scope = {
      ...(session === null ? {} : { userId: session.userId }),
      ...(tenantId === null ? {} : { tenantId }),
    };
    const { requestId, logger } = deps.requestContext({
      requestIdHeader: request.headers.get(REQUEST_ID_HEADER),
      ...scope,
    });
    return { requestId, session, tenantId, logger };
  };
}
