import { describe, expect, it } from "vitest";
import { ConfigError } from "./build-config";
import { loadRuntimeConfig } from "./load";

describe("loadRuntimeConfig", () => {
  it("reads and validates the baked in extra values", () => {
    const constants = {
      expoConfig: { extra: { appEnv: "staging", apiUrl: "https://api.example.test" } },
    };
    expect(loadRuntimeConfig(constants)).toEqual({
      appEnv: "staging",
      apiUrl: "https://api.example.test",
    });
  });

  it("fails when the app config has no extra section", () => {
    expect(() => loadRuntimeConfig({ expoConfig: null })).toThrow(ConfigError);
    expect(() => loadRuntimeConfig({})).toThrow(/extra: missing/);
  });

  it("ignores values that are not strings", () => {
    const constants = { expoConfig: { extra: { appEnv: 7, apiUrl: { url: "x" } } } };
    expect(() => loadRuntimeConfig(constants)).toThrow(/API_URL: is required/);
  });
});
