import type { IdGenerator, Logger } from "../app/ports";

/** Safe to echo into logs and headers: no whitespace, quotes or control characters. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export interface RequestContextInput {
  /** Value of an incoming request id header. Used only when it passes validation. */
  readonly requestIdHeader?: string | null | undefined;
  readonly tenantId?: string;
  readonly userId?: string;
}

export interface RequestContext {
  readonly requestId: string;
  readonly tenantId?: string;
  readonly userId?: string;
  /** Every line written through this logger carries the same request id. */
  readonly logger: Logger;
}

function pickRequestId(header: string | null | undefined, ids: IdGenerator): string {
  return header != null && REQUEST_ID_PATTERN.test(header) ? header : ids.next();
}

export function makeRequestContextBuilder(deps: {
  readonly ids: IdGenerator;
  readonly logger: Logger;
}): (input: RequestContextInput) => RequestContext {
  return (input) => {
    const requestId = pickRequestId(input.requestIdHeader, deps.ids);
    const scope = {
      ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
      ...(input.userId === undefined ? {} : { userId: input.userId }),
    };
    return { requestId, ...scope, logger: deps.logger.child({ requestId, ...scope }) };
  };
}
