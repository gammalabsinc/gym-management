import { describe, expect, it } from "vitest";
import { uuidGenerator } from "./ids";

describe("uuidGenerator", () => {
  it("returns a new uuid each call", () => {
    const [a, b] = [uuidGenerator.next(), uuidGenerator.next()];
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});
