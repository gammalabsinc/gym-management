import { describe, expect, it } from "vitest";
import {
  isSensitiveKey,
  MAX_DEPTH,
  REDACTED,
  redactFields,
  redactText,
  redactValue,
} from "./redact";

describe("isSensitiveKey", () => {
  it.each([
    "token",
    "accessToken",
    "Authorization",
    "password",
    "client_secret",
    "Cookie",
    "sessionId",
    "api-key",
    "apiKey",
    "email",
    "memberEmail",
    "barcode",
  ])("flags %s", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(["requestId", "tenantId", "userId", "status", "count"])("allows %s", (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

describe("redactText", () => {
  it("masks emails, bearer tokens and jwts inside text", () => {
    const jwt = "eyJhbGciOi.eyJzdWIiOiIx.c2ln";
    const out = redactText(`mail a.b+c@x.co with Bearer abc.DEF-123= and ${jwt} done`);
    expect(out).toBe(`mail ${REDACTED} with ${REDACTED} and ${REDACTED} done`);
  });

  it("leaves safe text alone", () => {
    expect(redactText("member joined at 9am")).toBe("member joined at 9am");
  });
});

describe("redactValue", () => {
  it("passes through null, undefined, numbers and booleans", () => {
    expect([null, undefined, 3, false].map((v) => redactValue(v))).toEqual([
      null,
      undefined,
      3,
      false,
    ]);
  });

  it("redacts by key before looking at the value, at any depth", () => {
    expect(redactValue({ a: { password: "x", ok: 1 }, list: [{ token: "t" }] })).toEqual({
      a: { password: REDACTED, ok: 1 },
      list: [{ token: REDACTED }],
    });
  });

  it("scrubs strings and converts values JSON cannot hold", () => {
    expect(redactValue("me@x.com")).toBe(REDACTED);
    expect(redactValue(10n)).toBe("10");
    expect(redactValue(() => 1)).toBe("[function]");
    expect(redactValue(Symbol("s"))).toBe("[symbol]");
    expect(redactValue(new Date("2026-01-02T03:04:05Z"))).toBe("2026-01-02T03:04:05.000Z");
    expect(redactValue(new Date("nope"))).toBe("[invalid date]");
  });

  it("keeps only the name and a scrubbed message of an error, never the stack", () => {
    const error = new TypeError("bad input from me@x.com");
    const out = redactValue(error);
    expect(out).toEqual({ name: "TypeError", message: `bad input from ${REDACTED}` });
    expect(JSON.stringify(out)).not.toContain("at ");
  });

  it("ends on a cycle instead of looping", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => JSON.stringify(redactValue(loop))).not.toThrow();
    let node: unknown = redactValue(loop);
    for (let i = 0; i < MAX_DEPTH; i++) node = (node as Record<string, unknown>).self;
    expect(node).toBe("[truncated]");
  });
});

describe("redactFields", () => {
  it("returns a redacted copy and leaves the input untouched", () => {
    const input = { token: "t", n: 1 };
    expect(redactFields(input)).toEqual({ token: REDACTED, n: 1 });
    expect(input).toEqual({ token: "t", n: 1 });
  });
});
