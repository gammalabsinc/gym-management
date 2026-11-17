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

describe("role passwords", () => {
  const passwords = {
    MIGRATOR_ROLE_PASSWORD: "migrator-password-0123",
    APP_ROLE_PASSWORD: "app-password-01234567",
  };

  it("are left out when unset or when only one is set", () => {
    expect(parseConfig(validEnv)).not.toHaveProperty("rolePasswords");
    expect(
      parseConfig({ ...validEnv, MIGRATOR_ROLE_PASSWORD: passwords.MIGRATOR_ROLE_PASSWORD }),
    ).not.toHaveProperty("rolePasswords");
    expect(
      parseConfig({ ...validEnv, APP_ROLE_PASSWORD: passwords.APP_ROLE_PASSWORD }),
    ).not.toHaveProperty("rolePasswords");
  });

  it("are read when both are set and redacted for logs", () => {
    const config = parseConfig({ ...validEnv, MODE: "provision", ...passwords });
    expect(config.rolePasswords).toEqual({
      migratorPassword: passwords.MIGRATOR_ROLE_PASSWORD,
      appPassword: passwords.APP_ROLE_PASSWORD,
    });
    expect(JSON.stringify(redactConfig(config))).not.toContain("password-0123");
    expect(redactConfig(config)).toMatchObject({ rolePasswords: "[redacted]" });
  });

  it("must be at least 16 characters", () => {
    expect(problemsOf({ ...validEnv, ...passwords, APP_ROLE_PASSWORD: "short" })).toEqual([
      expect.stringMatching(/^APP_ROLE_PASSWORD: /),
    ]);
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

describe("onboarding variables", () => {
  const gym = {
    GYM_NAME: "Iron Works",
    GYM_SUBDOMAIN: "iron-works",
    GYM_TIMEZONE: "America/Toronto",
    GYM_CURRENCY: "CAD",
    OWNER_EMAIL: "owner@example.test",
  };

  it("are left out unless every required variable is set", () => {
    expect(parseConfig(validEnv)).not.toHaveProperty("onboarding");
    for (const missing of Object.keys(gym)) {
      const partial = { ...gym, [missing]: undefined };
      expect(parseConfig({ ...validEnv, ...partial })).not.toHaveProperty("onboarding");
    }
  });

  it("are read with the fees defaulting to zero", () => {
    expect(parseConfig({ ...validEnv, ...gym }).onboarding).toEqual({
      name: "Iron Works",
      subdomain: "iron-works",
      timezone: "America/Toronto",
      currency: "CAD",
      ownerEmail: "owner@example.test",
      ownerName: undefined,
      admissionFee: 0,
      monthlyFee: 0,
    });
  });

  it("carry the owner name and the fees when set", () => {
    const config = parseConfig({
      ...validEnv,
      ...gym,
      OWNER_NAME: "Sam Owner",
      ADMISSION_FEE: "2000",
      MONTHLY_FEE: "5000",
    });
    expect(config.onboarding).toMatchObject({
      ownerName: "Sam Owner",
      admissionFee: 2000,
      monthlyFee: 5000,
    });
  });

  it("refuse a fee that is not a whole number of minor units", () => {
    for (const value of ["-1", "1.5", "abc", "3000000000"]) {
      expect(problemsOf({ ...validEnv, ...gym, MONTHLY_FEE: value })).toEqual([
        expect.stringMatching(/^MONTHLY_FEE: /),
      ]);
    }
  });

  it("are redacted for logs", () => {
    const config = parseConfig({ ...validEnv, ...gym });
    expect(JSON.stringify(redactConfig(config))).not.toContain("owner@example.test");
    expect(redactConfig(config)).toMatchObject({ onboarding: "[redacted]" });
  });
});
