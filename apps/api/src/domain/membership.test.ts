import { describe, expect, it } from "vitest";
import {
  effectiveDate,
  MAX_REASON_LENGTH,
  type MembershipAction,
  nextStatus,
  parseReason,
} from "./membership";
import type { MembershipStatus } from "./standing";

describe("parseReason", () => {
  it("trims a reason", () => {
    expect(parseReason("  moved away ")).toEqual({ ok: true, value: "moved away" });
  });

  it("requires a reason", () => {
    const result = parseReason("   ");
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.issues).toEqual([{ path: ["reason"], message: "A reason is required" }]);
  });

  it("caps the length", () => {
    expect(parseReason("x".repeat(MAX_REASON_LENGTH)).ok).toBe(true);
    const result = parseReason("x".repeat(MAX_REASON_LENGTH + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.issues[0]?.path).toEqual(["reason"]);
  });
});

describe("nextStatus", () => {
  const table: readonly [MembershipAction, MembershipStatus, MembershipStatus | "conflict"][] = [
    ["pause", "active", "paused"],
    ["pause", "paused", "conflict"],
    ["pause", "cancelled", "conflict"],
    ["resume", "paused", "active"],
    ["resume", "active", "conflict"],
    ["resume", "cancelled", "conflict"],
    ["cancel", "active", "cancelled"],
    ["cancel", "paused", "cancelled"],
    ["cancel", "cancelled", "conflict"],
  ];

  it.each(table)("%s from %s gives %s", (action, from, expected) => {
    const result = nextStatus(action, from);
    if (expected === "conflict") {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("conflict");
    } else {
      expect(result).toEqual({ ok: true, value: expected });
    }
  });

  it("names the action in the conflict message", () => {
    const result = nextStatus("resume", "active");
    if (!result.ok) expect(result.error.message).toBe("A active membership cannot be resumed");
  });
});

describe("effectiveDate", () => {
  it("is today", () => {
    expect(effectiveDate("2026-11-16", "2026-11-01")).toBe("2026-11-16");
  });

  it("never goes before the current period began", () => {
    expect(effectiveDate("2026-11-16", "2026-11-17")).toBe("2026-11-17");
  });
});
