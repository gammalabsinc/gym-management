import { describe, expect, it } from "vitest";
import type { LogContext, Logger, LogMethod } from "../app/ports";
import { makeContextBuilder, type Session } from "./context";
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
    resolveSession: () => session,
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
  it("builds an anonymous context with a generated request id", () => {
    const { build } = setup(null);
    const ctx = build(request());
    expect(ctx).toMatchObject({ requestId: "generated-id", session: null, tenantId: null });
  });

  it("uses a valid incoming request id", () => {
    const { build } = setup(null);
    expect(build(request({ "x-request-id": "abc-123" })).requestId).toBe("abc-123");
  });

  it("ignores an unsafe incoming request id", () => {
    const { build } = setup(null);
    expect(build(request({ "x-request-id": 'bad id"' })).requestId).toBe("generated-id");
  });

  it("takes the tenant from the session and tags log lines with it", () => {
    const { build, lines } = setup({ userId: "u1", tenantId: "t1" });
    const ctx = build(request());
    ctx.logger.info("hello");
    expect(ctx.tenantId).toBe("t1");
    expect(ctx.session).toEqual({ userId: "u1", tenantId: "t1" });
    expect(lines[0]).toMatchObject({ userId: "u1", tenantId: "t1", requestId: "generated-id" });
  });

  it("leaves the tenant empty for an identity session", () => {
    const { build, lines } = setup({ userId: "u1", tenantId: null });
    const ctx = build(request());
    ctx.logger.info("hello");
    expect(ctx.tenantId).toBeNull();
    expect(lines[0]).not.toHaveProperty("tenantId");
  });
});
