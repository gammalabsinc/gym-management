import { describe, expect, it } from "vitest";
import { composeApp } from "./compose";

describe("composeApp", () => {
  it("wires the greeting end to end with real adapters", () => {
    const { greeting } = composeApp();
    expect(greeting({ name: "Sam" }).message).toMatch(/^Good (morning|afternoon|evening), Sam$/);
  });
});
