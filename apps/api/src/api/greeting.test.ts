import { describe, expect, it } from "vitest";
import { makeGreetingResolver } from "./greeting";

const resolver = makeGreetingResolver((input) => ({ message: `hi ${input.name}` }));

describe("makeGreetingResolver", () => {
  it("passes parsed input to the use case", () => {
    expect(resolver({ name: "  Sam " })).toEqual({ message: "hi Sam" });
  });

  it.each([{}, { name: "" }, { name: "   " }, { name: 5 }, { name: "x".repeat(101) }, null])(
    "rejects invalid input %j",
    (args) => {
      expect(() => resolver(args)).toThrow();
    },
  );
});
