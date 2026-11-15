import { type ApiError, toApiError } from "./errors";
import type { DataOf, Operation } from "./operation";

/** The four outcomes every screen renders. Network failure, API error and empty result stay distinct. */
export type Outcome<Data> =
  | { readonly status: "data"; readonly data: Data }
  | { readonly status: "empty" }
  | { readonly status: "network"; readonly message: string }
  | { readonly status: "error"; readonly error: ApiError };

export interface ClientDeps {
  readonly apiUrl: string;
  readonly getToken: () => string | null;
  /** Called when the server says the session is expired or revoked. */
  readonly onUnauthenticated: () => void;
  readonly newRequestId: () => string;
  readonly fetch: typeof fetch;
}

export interface Client {
  execute<O extends Operation<unknown>>(operation: O): Promise<Outcome<DataOf<O>>>;
}

export const NETWORK_MESSAGE = "Could not reach the server. Check your connection and try again.";

function isEmpty(data: Record<string, unknown>): boolean {
  const values = Object.values(data);
  return values.every(
    (value) =>
      value === null ||
      (Array.isArray(value) && value.length === 0) ||
      (typeof value === "object" &&
        "items" in value &&
        Array.isArray(value.items) &&
        value.items.length === 0),
  );
}

function bodyOf(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

/** The single place that attaches the bearer token and the request id, and reads what comes back. */
export function createClient(deps: ClientDeps): Client {
  return {
    async execute<O extends Operation<unknown>>(operation: O): Promise<Outcome<DataOf<O>>> {
      const requestId = deps.newRequestId();
      const token = deps.getToken();
      let response: Response;
      try {
        response = await deps.fetch(deps.apiUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-request-id": requestId,
            ...(token === null ? {} : { authorization: `Bearer ${token}` }),
          },
          body: JSON.stringify({
            query: operation.document,
            variables: operation.variables,
            operationName: operation.name,
          }),
        });
      } catch {
        return { status: "network", message: NETWORK_MESSAGE };
      }
      const body = (await bodyOf(response)) as {
        data?: Record<string, unknown> | null;
        errors?: unknown;
      } | null;
      const failed = body?.errors !== undefined || !response.ok;
      if (failed) {
        const error =
          body?.errors === undefined && response.status === 401
            ? toApiError([{ extensions: { code: "UNAUTHENTICATED" } }], requestId)
            : toApiError(
                body?.errors ?? [{ extensions: { code: statusCode(response.status) } }],
                requestId,
              );
        if (error.code === "UNAUTHENTICATED") deps.onUnauthenticated();
        return { status: "error", error };
      }
      const data = body?.data ?? null;
      if (data === null || isEmpty(data)) return { status: "empty" };
      return { status: "data", data: data as DataOf<O> };
    },
  };
}

function statusCode(status: number): string {
  if (status === 429) return "RATE_LIMITED";
  return "INTERNAL_SERVER_ERROR";
}
