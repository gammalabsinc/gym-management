import { describe, expect, it, vi } from "vitest";
import { createClient, NETWORK_MESSAGE } from "./client";
import { query } from "./operation";

const op = query("Health", { health: true });

function setup(respond: () => Promise<Response>, token: string | null = "tok") {
  const calls: { url: string; init: RequestInit }[] = [];
  const onUnauthenticated = vi.fn();
  const client = createClient({
    apiUrl: "https://api.test/graphql",
    getToken: () => token,
    onUnauthenticated,
    newRequestId: () => "req-1",
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return respond();
    },
  });
  return { client, calls, onUnauthenticated };
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("createClient", () => {
  it("sends the bearer token, the request id and the operation", async () => {
    const { client, calls } = setup(() => json({ data: { health: "ok" } }));
    const outcome = await client.execute(op);
    expect(outcome).toEqual({ status: "data", data: { health: "ok" } });
    const { url, init } = calls[0] ?? { url: "", init: {} };
    expect(url).toBe("https://api.test/graphql");
    expect(init.headers).toEqual({
      "content-type": "application/json",
      "x-request-id": "req-1",
      authorization: "Bearer tok",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      query: "query Health { health }",
      variables: {},
      operationName: "Health",
    });
  });

  it("omits the authorization header when signed out", async () => {
    const { client, calls } = setup(() => json({ data: { health: "ok" } }), null);
    await client.execute(op);
    expect(calls[0]?.init.headers).not.toHaveProperty("authorization");
  });

  it("reports a network failure as its own state", async () => {
    const { client } = setup(() => Promise.reject(new TypeError("offline")));
    expect(await client.execute(op)).toEqual({ status: "network", message: NETWORK_MESSAGE });
  });

  it("reports an API error with a mapped message, not the server text", async () => {
    const { client, onUnauthenticated } = setup(() =>
      json({
        data: null,
        errors: [
          {
            message: "stack trace here",
            extensions: { code: "INTERNAL_SERVER_ERROR", requestId: "srv-5" },
          },
        ],
      }),
    );
    const outcome = await client.execute(op);
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") return;
    expect(outcome.error.message).toBe("Something went wrong. Reference: srv-5");
    expect(JSON.stringify(outcome)).not.toContain("stack trace");
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it("signs the user out on an unauthenticated error", async () => {
    const { client, onUnauthenticated } = setup(() =>
      json({ errors: [{ extensions: { code: "UNAUTHENTICATED", requestId: "r" } }] }),
    );
    const outcome = await client.execute(op);
    expect(outcome).toMatchObject({ status: "error", error: { code: "UNAUTHENTICATED" } });
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it("signs the user out on a bare 401", async () => {
    const { client, onUnauthenticated } = setup(() => json({}, 401));
    expect(await client.execute(op)).toMatchObject({
      status: "error",
      error: { code: "UNAUTHENTICATED" },
    });
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it("maps a throttled response without a GraphQL body", async () => {
    const { client } = setup(() => json({}, 429));
    expect(await client.execute(op)).toMatchObject({
      status: "error",
      error: { code: "RATE_LIMITED" },
    });
  });

  it("maps other failures without a readable body to the generic error", async () => {
    const { client } = setup(() => Promise.resolve(new Response("<html>", { status: 502 })));
    expect(await client.execute(op)).toMatchObject({
      status: "error",
      error: { code: "INTERNAL_SERVER_ERROR", requestId: "req-1" },
    });
  });

  it("reports an empty result for null, empty lists and empty pages", async () => {
    for (const data of [null, { member: null }, { myGyms: [] }, { members: { items: [] } }]) {
      const { client } = setup(() => json({ data }));
      expect(await client.execute(op)).toEqual({ status: "empty" });
    }
  });

  it("reports data when any root field has content", async () => {
    const { client } = setup(() => json({ data: { members: { items: [{ id: "1" }] } } }));
    expect((await client.execute(op)).status).toBe("data");
  });
});
