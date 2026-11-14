import { describe, expect, it } from "vitest";
import { makeGreet } from "./greet";

describe("makeGreet", () => {
  it("greets using the injected clock", () => {
    const greet = makeGreet({ clock: { now: () => new Date("2026-01-01T20:00:00Z") } });
    expect(greet({ name: "Sam" })).toEqual({ message: "Good evening, Sam" });
  });
});
