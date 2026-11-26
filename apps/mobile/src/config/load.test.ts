import { describe, expect, it } from "vitest";
import { ConfigError } from "./build-config";
import { loadRuntimeConfig } from "./load";

describe("loadRuntimeConfig", () => {
  it("reads and validates the baked in extra values", () => {
    const constants = {
      expoConfig: {
        extra: {
          profile: "internal",
          apiUrl: "https://api.example.test",
          googleIosClientId: "1.apps.googleusercontent.com",
          googleAndroidClientId: "2.apps.googleusercontent.com",
        },
      },
    };
    expect(loadRuntimeConfig(constants)).toEqual({
      profile: "internal",
      apiUrl: "https://api.example.test",
      googleClientIds: {
        ios: "1.apps.googleusercontent.com",
        android: "2.apps.googleusercontent.com",
      },
    });
  });

  it("fails when the app config has no extra section", () => {
    expect(() => loadRuntimeConfig({ expoConfig: null })).toThrow(ConfigError);
    expect(() => loadRuntimeConfig({})).toThrow(/extra: missing/);
  });

  it("ignores values that are not strings", () => {
    const constants = { expoConfig: { extra: { profile: 7, apiUrl: { url: "x" } } } };
    expect(() => loadRuntimeConfig(constants)).toThrow(/API_URL: is required/);
  });

  it("names the Google client ids an internal build is missing", () => {
    const constants = {
      expoConfig: { extra: { profile: "internal", apiUrl: "https://api.example.test" } },
    };
    expect(() => loadRuntimeConfig(constants)).toThrow(/GOOGLE_IOS_CLIENT_ID: is required/);
  });
});
