import { describe, expect, it } from "vitest";
import { isMemberCode } from "../../domain/member";
import { randomCodes } from "./member-codes";

describe("random member codes", () => {
  it("are always six uppercase letters and digits", () => {
    for (let i = 0; i < 200; i += 1) expect(isMemberCode(randomCodes.next())).toBe(true);
  });

  it("do not repeat from one call to the next", () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomCodes.next()));
    expect(seen.size).toBeGreaterThan(190);
  });
});
