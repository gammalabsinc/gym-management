import { describe, expect, it } from "vitest";
import { buildGreeting, dayPartOfHour } from "./greeting";

describe("dayPartOfHour", () => {
  it.each([
    [0, "morning"],
    [11, "morning"],
    [12, "afternoon"],
    [17, "afternoon"],
    [18, "evening"],
    [23, "evening"],
  ] as const)("maps hour %i to %s", (hour, part) => {
    expect(dayPartOfHour(hour)).toBe(part);
  });
});

describe("buildGreeting", () => {
  it("includes the day part and the name", () => {
    expect(buildGreeting("Sam", 9)).toBe("Good morning, Sam");
  });
});
