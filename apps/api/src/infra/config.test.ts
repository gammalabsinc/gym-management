import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError, loadConfig, parseConfig, redactConfig } from "./config";

const validEnv = { DATABASE_URL: "postgres://user:s3cret@localhost:5432/gym" };

afterEach(() => {
  vi.unstubAllEnvs();
});

function problemsOf(env: Record<string, string | undefined>): readonly string[] {
  try {
    parseConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
  throw new Error("expected parseConfig to throw");
}

describe("MIGRATOR_DATABASE_URL", () => {
  it("is optional and left out when unset", () => {
    expect(parseConfig(validEnv)).not.toHaveProperty("migratorDatabaseUrl");
  });

  it("is read when set and redacted for logs", () => {
    const config = parseConfig({
      ...validEnv,
      MIGRATOR_DATABASE_URL: "postgres://migrator:pw@localhost/gym",
    });
    expect(config.migratorDatabaseUrl).toBe("postgres://migrator:pw@localhost/gym");
    expect(JSON.stringify(redactConfig(config))).not.toContain("pw@");
    expect(redactConfig(config)).toMatchObject({ migratorDatabaseUrl: "[redacted]" });
  });

  it("must be a url", () => {
    expect(problemsOf({ ...validEnv, MIGRATOR_DATABASE_URL: "nope" })).toEqual([
      expect.stringMatching(/^MIGRATOR_DATABASE_URL: /),
    ]);
  });
});

describe("parseConfig", () => {
  it("applies defaults", () => {
    expect(parseConfig(validEnv)).toEqual({
      nodeEnv: "development",
      mode: "api",
      port: 3000,
      logLevel: "info",
      databaseUrl: validEnv.DATABASE_URL,
    });
  });

  it("reads every variable", () => {
    expect(
      parseConfig({
        ...validEnv,
        NODE_ENV: "production",
        MODE: "worker",
        PORT: "8080",
        LOG_LEVEL: "warn",
      }),
    ).toMatchObject({ nodeEnv: "production", mode: "worker", port: 8080, logLevel: "warn" });
  });

  it("names a missing variable", () => {
    expect(problemsOf({})).toEqual([expect.stringMatching(/^DATABASE_URL: /)]);
  });

  it("names every invalid variable at once", () => {
    const problems = problemsOf({ ...validEnv, MODE: "nope", PORT: "70000", LOG_LEVEL: "loud" });
    expect(problems.map((p) => p.split(":")[0]).sort()).toEqual(["LOG_LEVEL", "MODE", "PORT"]);
  });

  it("rejects a port that is not a number", () => {
    expect(problemsOf({ ...validEnv, PORT: "abc" })[0]).toMatch(/^PORT: /);
  });

  it("never repeats a secret value in the error", () => {
    let message = "";
    try {
      parseConfig({ DATABASE_URL: "hunter2-not-a-url" });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain("DATABASE_URL");
    expect(message).not.toContain("hunter2");
  });
});

describe("ConfigError", () => {
  it("lists the problems in its message", () => {
    const error = new ConfigError(["A: bad", "B: worse"]);
    expect(error.name).toBe("ConfigError");
    expect(error.message).toBe("Invalid configuration:\n  A: bad\n  B: worse");
  });
});

describe("loadConfig", () => {
  it("reads process.env", () => {
    vi.stubEnv("DATABASE_URL", validEnv.DATABASE_URL);
    vi.stubEnv("MODE", "api"); // vitest sets MODE=test itself
    vi.stubEnv("PORT", "4000");
    expect(loadConfig().port).toBe(4000);
  });
});

describe("redactConfig", () => {
  it("hides the database url and keeps the rest", () => {
    const redacted = redactConfig(parseConfig(validEnv));
    expect(JSON.stringify(redacted)).not.toContain("s3cret");
    expect(redacted).toMatchObject({ databaseUrl: "[redacted]", port: 3000 });
  });
});
