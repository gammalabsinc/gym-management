import { describe, expect, it } from "vitest";
import { systemClock } from "./clock";

describe("systemClock", () => {
  it("returns the current time", () => {
    const before = Date.now();
    const value = systemClock.now().getTime();
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(Date.now());
  });
});
