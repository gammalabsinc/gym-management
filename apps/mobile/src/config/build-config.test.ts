import { describe, expect, it } from "vitest";
import { ConfigError, parseBuildEnv } from "./build-config";

const IOS = "111-ios.apps.googleusercontent.com";
const ANDROID = "222-android.apps.googleusercontent.com";
const API = "https://api.example.test";

const full = {
  API_URL: API,
  GOOGLE_IOS_CLIENT_ID: IOS,
  GOOGLE_ANDROID_CLIENT_ID: ANDROID,
};

function problemsOf(env: Record<string, string | undefined>): readonly string[] {
  try {
    parseBuildEnv(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

describe("parseBuildEnv, development", () => {
  it("is the default profile, strips trailing slashes and needs no Google client ids", () => {
    expect(parseBuildEnv({ API_URL: "http://localhost:3000/graphql//" })).toEqual({
      profile: "development",
      apiUrl: "http://localhost:3000/graphql",
      googleClientIds: null,
    });
  });

  it("treats an empty BUILD_PROFILE as development", () => {
    expect(parseBuildEnv({ BUILD_PROFILE: "", API_URL: "http://localhost:3000" }).profile).toBe(
      "development",
    );
  });
});

describe.each(["internal", "production"] as const)("parseBuildEnv, %s", (profile) => {
  it("resolves the API URL and both client ids", () => {
    expect(parseBuildEnv({ ...full, BUILD_PROFILE: profile })).toEqual({
      profile,
      apiUrl: API,
      googleClientIds: { ios: IOS, android: ANDROID },
    });
  });

  it("requires every value and names each missing one", () => {
    expect(problemsOf({ BUILD_PROFILE: profile })).toEqual([
      "API_URL: is required",
      "GOOGLE_IOS_CLIENT_ID: is required",
      "GOOGLE_ANDROID_CLIENT_ID: is required",
    ]);
  });

  it.each([["API_URL"], ["GOOGLE_IOS_CLIENT_ID"], ["GOOGLE_ANDROID_CLIENT_ID"]])(
    "names %s when only it is missing",
    (name) => {
      expect(problemsOf({ ...full, BUILD_PROFILE: profile, [name]: undefined })).toEqual([
        `${name}: is required`,
      ]);
      expect(problemsOf({ ...full, BUILD_PROFILE: profile, [name]: "" })).toEqual([
        `${name}: is required`,
      ]);
    },
  );

  it("requires https", () => {
    expect(problemsOf({ ...full, BUILD_PROFILE: profile, API_URL: "http://api.test" })).toEqual([
      `API_URL: must use https for ${profile}`,
    ]);
  });

  it("rejects a client id that is not a Google client id, without echoing it", () => {
    const problems = problemsOf({
      ...full,
      BUILD_PROFILE: profile,
      GOOGLE_IOS_CLIENT_ID: "sekret-value",
      GOOGLE_ANDROID_CLIENT_ID: "other-sekret",
    });
    expect(problems).toEqual([
      "GOOGLE_IOS_CLIENT_ID: must be a Google client id ending in .apps.googleusercontent.com",
      "GOOGLE_ANDROID_CLIENT_ID: must be a Google client id ending in .apps.googleusercontent.com",
    ]);
    expect(problems.join()).not.toContain("sekret");
  });
});

describe("parseBuildEnv, shared rules", () => {
  it("rejects an unknown profile", () => {
    expect(problemsOf({ BUILD_PROFILE: "staging", API_URL: API })).toEqual([
      "BUILD_PROFILE: must be one of development, internal, production",
    ]);
  });

  it("requires the API URL", () => {
    expect(problemsOf({})).toEqual(["API_URL: is required"]);
  });

  it("rejects a value that is not an absolute URL without echoing it", () => {
    const problems = problemsOf({ API_URL: "not a url secret" });
    expect(problems).toEqual(["API_URL: must be an absolute URL"]);
    expect(problems.join()).not.toContain("secret");
  });

  it("rejects other schemes", () => {
    expect(problemsOf({ API_URL: "ftp://files.test" })).toEqual([
      "API_URL: must start with http:// or https://",
    ]);
  });

  it("lists the problems in the error message", () => {
    expect(() => parseBuildEnv({})).toThrow(/Invalid app configuration:\n {2}API_URL: is required/);
  });
});
