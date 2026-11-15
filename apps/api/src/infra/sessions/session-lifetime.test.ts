import { describe, expect, it } from "vitest";
import { expiresAfter } from "./session-lifetime";

describe("expiresAfter", () => {
  it("adds the lifetime to the issue time", () => {
    const expiry = expiresAfter(3_600_000)(new Date("2026-01-10T12:00:00Z"));
    expect(expiry).toEqual(new Date("2026-01-10T13:00:00Z"));
  });

  it.each([0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses a lifetime of %s",
    (lifetime) => {
      expect(() => expiresAfter(lifetime)).toThrow(/lifetime/i);
    },
  );
});
