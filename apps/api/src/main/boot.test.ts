import { describe, expect, it, vi } from "vitest";
import { bootConfig } from "./boot";

class ExitSignal extends Error {}

function makeDeps(env: Record<string, string | undefined>) {
  const writeError = vi.fn();
  const exit = vi.fn((code: number): never => {
    throw new ExitSignal(`exit ${code}`);
  });
  return { deps: { env, writeError, exit }, writeError, exit };
}

describe("bootConfig", () => {
  it("returns the config for a valid environment", () => {
    const { deps, exit } = makeDeps({ DATABASE_URL: "postgres://localhost/gym" });
    expect(bootConfig(deps).databaseUrl).toBe("postgres://localhost/gym");
    expect(exit).not.toHaveBeenCalled();
  });

  it("fails fast with a message naming the variable", () => {
    const { deps, writeError, exit } = makeDeps({});
    expect(() => bootConfig(deps)).toThrow(ExitSignal);
    expect(exit).toHaveBeenCalledWith(1);
    expect(writeError).toHaveBeenCalledWith(expect.stringContaining("DATABASE_URL"));
  });

  it("rethrows errors that are not configuration problems", () => {
    const { deps } = makeDeps({});
    const broken = {
      ...deps,
      env: new Proxy(
        {},
        {
          get: () => {
            throw new TypeError("boom");
          },
        },
      ),
    };
    expect(() => bootConfig(broken)).toThrow(TypeError);
  });
});
