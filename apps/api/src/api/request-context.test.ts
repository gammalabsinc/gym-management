import { describe, expect, it } from "vitest";
import type { Logger } from "../app/ports";
import { makeLogger } from "../infra/logger";
import { makeRequestContextBuilder } from "./request-context";

function setup() {
  const lines: Record<string, unknown>[] = [];
  const logger: Logger = makeLogger({
    clock: { now: () => new Date(0) },
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    level: "debug",
  });
  let n = 0;
  const build = makeRequestContextBuilder({ ids: { next: () => `gen-${++n}` }, logger });
  return { build, lines };
}

describe("makeRequestContextBuilder", () => {
  it("generates a request id when none is sent", () => {
    const { build } = setup();
    expect(build({}).requestId).toBe("gen-1");
    expect(build({ requestIdHeader: null }).requestId).toBe("gen-2");
    expect(build({ requestIdHeader: undefined }).requestId).toBe("gen-3");
  });

  it("uses a well formed incoming id", () => {
    const { build } = setup();
    expect(build({ requestIdHeader: "abc-123_X.y" }).requestId).toBe("abc-123_X.y");
  });

  it.each(["", "has space", 'quo"te', "line\nbreak", "a".repeat(129), "é"])(
    "replaces the unsafe incoming id %j",
    (header) => {
      const { build } = setup();
      expect(build({ requestIdHeader: header }).requestId).toBe("gen-1");
    },
  );

  it("stamps the id, tenant and user on every line written through its logger", () => {
    const { build, lines } = setup();
    const ctx = build({ requestIdHeader: "r1", tenantId: "t1", userId: "u1" });
    ctx.logger.info("a");
    ctx.logger.error("b");
    expect(ctx).toMatchObject({ requestId: "r1", tenantId: "t1", userId: "u1" });
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toMatchObject({ requestId: "r1", tenantId: "t1", userId: "u1" });
    }
  });

  it("omits tenant and user when there is no session yet", () => {
    const { build, lines } = setup();
    const ctx = build({});
    ctx.logger.info("a");
    expect(ctx).not.toHaveProperty("tenantId");
    expect(ctx).not.toHaveProperty("userId");
    expect(lines[0]).not.toHaveProperty("tenantId");
  });

  it("keeps two requests apart", () => {
    const { build, lines } = setup();
    build({}).logger.info("a");
    build({}).logger.info("b");
    expect(lines.map((line) => line.requestId)).toEqual(["gen-1", "gen-2"]);
  });
});
