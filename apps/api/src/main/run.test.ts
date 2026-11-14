import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "./run";

class ExitSignal extends Error {}

const servers: ReturnType<typeof run>[] = [];

function makeDeps(env: Record<string, string | undefined>) {
  const lines: string[] = [];
  const writeError = vi.fn();
  const exit = vi.fn((code: number): never => {
    throw new ExitSignal(`exit ${code}`);
  });
  return {
    deps: { env, write: (line: string) => lines.push(line), writeError, exit },
    lines,
    writeError,
    exit,
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

describe("run", () => {
  it("starts the api, logs the port and answers the health check", async () => {
    const { deps, lines } = makeDeps({ DATABASE_URL: "postgres://localhost/gym", PORT: "38271" });
    const server = run(deps);
    servers.push(server);
    await vi.waitFor(() => expect(server.listening).toBe(true));
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/healthz`,
    );
    expect(response.status).toBe(200);
    const logged = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(logged).toMatchObject({ msg: "api listening", port: 38271, mode: "api" });
  });

  it("refuses a mode that is not implemented yet", () => {
    const { deps, writeError, exit } = makeDeps({
      DATABASE_URL: "postgres://localhost/gym",
      MODE: "worker",
    });
    expect(() => run(deps)).toThrow(ExitSignal);
    expect(writeError).toHaveBeenCalledWith("MODE=worker is not implemented yet");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("fails fast on an invalid environment", () => {
    const { deps, exit } = makeDeps({});
    expect(() => run(deps)).toThrow(ExitSignal);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
