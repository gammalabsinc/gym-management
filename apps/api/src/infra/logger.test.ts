import { describe, expect, it } from "vitest";
import type { Clock } from "../app/ports";
import { makeLogger, makeLoggingReporter } from "./logger";

const clock: Clock = { now: () => new Date("2026-11-14T10:00:00.000Z") };

function setup(level: "debug" | "info" | "warn" | "error" = "debug") {
  const lines: string[] = [];
  const logger = makeLogger({ clock, write: (line) => lines.push(line), level });
  const parsed = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { logger, lines, parsed };
}

describe("makeLogger", () => {
  it("writes one JSON line with time, level, message and fields", () => {
    const { logger, parsed } = setup();
    logger.info("hello", { count: 2 });
    expect(parsed()).toEqual([
      { time: "2026-11-14T10:00:00.000Z", level: "info", msg: "hello", count: 2 },
    ]);
  });

  it("writes every level", () => {
    const { logger, parsed } = setup();
    logger.debug("a");
    logger.info("b");
    logger.warn("c");
    logger.error("d");
    expect(parsed().map((line) => line.level)).toEqual(["debug", "info", "warn", "error"]);
  });

  it("drops lines below the configured level", () => {
    const { logger, parsed } = setup("warn");
    logger.debug("a");
    logger.info("b");
    logger.warn("c");
    logger.error("d");
    expect(parsed().map((line) => line.msg)).toEqual(["c", "d"]);
  });

  it("carries the same request id, tenant id and user id on every line of a child", () => {
    const { logger, parsed } = setup();
    const scoped = logger.child({ requestId: "r1", tenantId: "t1", userId: "u1" });
    scoped.info("one");
    scoped.error("two");
    for (const line of parsed()) {
      expect(line).toMatchObject({ requestId: "r1", tenantId: "t1", userId: "u1" });
    }
    expect(parsed()).toHaveLength(2);
  });

  it("adds context in stages but never replaces a request id already set", () => {
    const { logger, parsed } = setup();
    logger.child({ requestId: "r1" }).child({ requestId: "other", userId: "u1" }).info("x");
    expect(parsed()[0]).toMatchObject({ requestId: "r1", userId: "u1" });
  });

  it("takes a request id from a child when the parent has none, and skips empty values", () => {
    const { logger, parsed } = setup();
    logger.child({ requestId: "r2", tenantId: "" }).info("x");
    expect(parsed()[0]).toMatchObject({ requestId: "r2" });
    expect(parsed()[0]).not.toHaveProperty("tenantId");
  });

  it("lets a later child set the tenant after the first one", () => {
    const { logger, parsed } = setup();
    logger.child({ requestId: "r1" }).child({ tenantId: "t9" }).info("x");
    expect(parsed()[0]).toMatchObject({ requestId: "r1", tenantId: "t9" });
  });

  it("never logs tokens, emails or barcodes, in fields or in the message", () => {
    const { logger, lines } = setup();
    logger.info("signed in me@x.com", {
      token: "abc123",
      email: "me@x.com",
      member: { barcode: "A1B2C3", note: "Bearer abc.def" },
    });
    const text = lines.join("");
    for (const secret of ["abc123", "me@x.com", "A1B2C3", "abc.def"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("keeps fields that clash with fixed keys under a field_ prefix", () => {
    const { logger, parsed } = setup();
    logger.child({ requestId: "r1" }).info("x", { requestId: "spoofed", level: "debug", extra: 1 });
    expect(parsed()[0]).toMatchObject({
      requestId: "r1",
      level: "info",
      field_requestId: "spoofed",
      field_level: "debug",
      extra: 1,
    });
  });
});

describe("makeLoggingReporter", () => {
  it("logs the original cause under the request id without a stack", () => {
    const { logger, parsed } = setup();
    makeLoggingReporter(logger)(new Error("db down for me@x.com"), "req-7");
    const [line] = parsed();
    expect(line).toMatchObject({
      level: "error",
      msg: "unexpected error",
      requestId: "req-7",
      error: { name: "Error", message: "db down for [redacted]" },
    });
    expect(JSON.stringify(line)).not.toContain("    at ");
  });
});
