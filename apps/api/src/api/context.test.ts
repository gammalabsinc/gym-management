import { describe, expect, it } from "vitest";
import type { LogContext, Logger, LogMethod } from "../app/ports";
import { bearerSessionResolver, makeContextBuilder, type Session } from "./context";
import { makeRequestContextBuilder } from "./request-context";

function makeLogger(lines: Record<string, unknown>[], scope: LogContext = {}): Logger {
  const write =
    (level: string): LogMethod =>
    (msg, fields = {}) => {
      lines.push({ level, msg, ...scope, ...fields });
    };
  return {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    child: (context) => makeLogger(lines, { ...scope, ...context }),
  };
}

function setup(session: Session | null) {
  const lines: Record<string, unknown>[] = [];
  const build = makeContextBuilder({
    resolveSession: async () => session,
    requestContext: makeRequestContextBuilder({
      ids: { next: () => "generated-id" },
      logger: makeLogger(lines),
    }),
  });
  return { build, lines };
}

const request = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/graphql", { headers });

describe("makeContextBuilder", () => {
  it("builds an anonymous context with a generated request id", async () => {
    const { build } = setup(null);
    const ctx = await build(request());
    expect(ctx).toMatchObject({ requestId: "generated-id", session: null, tenantId: null });
  });

  it("uses a valid incoming request id", async () => {
    const { build } = setup(null);
    expect((await build(request({ "x-request-id": "abc-123" }))).requestId).toBe("abc-123");
  });

  it("ignores an unsafe incoming request id", async () => {
    const { build } = setup(null);
    expect((await build(request({ "x-request-id": 'bad id"' }))).requestId).toBe("generated-id");
  });

  it("takes the tenant from the session and tags log lines with it", async () => {
    const session = { sessionId: "s1", subject: "s1", userId: "u1", tenantId: "t1" };
    const { build, lines } = setup(session);
    const ctx = await build(request());
    ctx.logger.info("hello");
    expect(ctx.tenantId).toBe("t1");
    expect(ctx.session).toEqual(session);
    expect(lines[0]).toMatchObject({ userId: "u1", tenantId: "t1", requestId: "generated-id" });
  });

  it("leaves the tenant and user empty for an identity session", async () => {
    const { build, lines } = setup({
      sessionId: "s1",
      subject: "s1",
      userId: null,
      tenantId: null,
    });
    const ctx = await build(request());
    ctx.logger.info("hello");
    expect(ctx.tenantId).toBeNull();
    expect(lines[0]).not.toHaveProperty("tenantId");
    expect(lines[0]).not.toHaveProperty("userId");
  });

  it("carries the bearer token of the request, and none without one", async () => {
    const { build } = setup(null);
    const withToken = new Request("http://localhost/graphql", {
      headers: { authorization: "Bearer abc" },
    });
    expect((await build(withToken)).token).toBe("abc");
    expect((await build(request())).token).toBeNull();
  });

  it("ignores a tenant id the client sends in headers or query", async () => {
    const { build } = setup({ sessionId: "s1", subject: "s1", userId: "u1", tenantId: "t1" });
    const sneaky = new Request("http://localhost/graphql?tenantId=t2", {
      headers: { "x-tenant-id": "t2", "x-tenant": "t2", host: "t2.example.com" },
    });
    expect((await build(sneaky)).tenantId).toBe("t1");
    const anonymous = setup(null).build;
    expect((await anonymous(sneaky)).tenantId).toBeNull();
  });
});

describe("bearerSessionResolver", () => {
  it("passes the authorization header on, or null when there is none", async () => {
    const seen: (string | null)[] = [];
    const resolve = bearerSessionResolver(async (authorization) => {
      seen.push(authorization);
      return null;
    });
    await resolve(request({ authorization: "Bearer abc" }));
    await resolve(request());
    expect(seen).toEqual(["Bearer abc", null]);
  });
});
