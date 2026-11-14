export interface HttpResult {
  readonly status: number;
  readonly body: Readonly<Record<string, string>>;
}

const HEALTH_PATH = "/healthz";

/** Pure routing for the plain HTTP surface. The GraphQL endpoint is added by its own ticket. */
export function routeRequest(method: string | undefined, url: string | undefined): HttpResult {
  const path = (url ?? "").split("?")[0];
  if (path !== HEALTH_PATH) return { status: 404, body: { error: "not_found" } };
  if (method !== "GET") return { status: 405, body: { error: "method_not_allowed" } };
  return { status: 200, body: { status: "ok" } };
}
