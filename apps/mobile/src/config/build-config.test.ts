import { describe, expect, it } from "vitest";
import { ConfigError, parseBuildEnv } from "./build-config";

function problemsOf(env: Record<string, string | undefined>): readonly string[] {
  try {
    parseBuildEnv(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  return [];
}

describe("parseBuildEnv", () => {
  it("defaults to development and strips trailing slashes", () => {
    expect(parseBuildEnv({ API_URL: "http://localhost:3000/graphql//" })).toEqual({
      appEnv: "development",
      apiUrl: "http://localhost:3000/graphql",
    });
  });

  it("treats an empty APP_ENV as development", () => {
    expect(parseBuildEnv({ APP_ENV: "", API_URL: "http://localhost:3000" }).appEnv).toBe(
      "development",
    );
  });

  it("accepts https for staging and production", () => {
    expect(parseBuildEnv({ APP_ENV: "staging", API_URL: "https://api.example.test" })).toEqual({
      appEnv: "staging",
      apiUrl: "https://api.example.test",
    });
    expect(
      parseBuildEnv({ APP_ENV: "production", API_URL: "https://api.example.test" }).appEnv,
    ).toBe("production");
  });

  it("requires the API URL", () => {
    expect(problemsOf({})).toEqual(["API_URL: is required"]);
    expect(problemsOf({ API_URL: "" })).toEqual(["API_URL: is required"]);
  });

  it("rejects an unknown environment", () => {
    expect(problemsOf({ APP_ENV: "qa", API_URL: "https://x.test" })).toEqual([
      "APP_ENV: must be one of development, staging, production",
    ]);
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

  it("requires https outside development", () => {
    expect(problemsOf({ APP_ENV: "production", API_URL: "http://api.test" })).toEqual([
      "API_URL: must use https for production",
    ]);
  });

  it("lists the problems in the error message", () => {
    expect(() => parseBuildEnv({})).toThrow(/Invalid app configuration:\n {2}API_URL: is required/);
  });
});
