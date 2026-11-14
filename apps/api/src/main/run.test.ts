import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "./run";

class ExitSignal extends Error {}

const servers: Server[] = [];

function makeDeps(env: Record<string, string | undefined>) {
  const lines: string[] = [];
  const writeError = vi.fn();
  const exit = vi.fn((code: number): never => {
    throw new ExitSignal(`exit ${code}`);
  });
  const migrate = vi.fn(async (_url: string): Promise<readonly string[]> => ["First1", "Second2"]);
  return {
    deps: { env, write: (line: string) => lines.push(line), writeError, exit, migrate },
    lines,
    writeError,
    exit,
    migrate,
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

const DATABASE_URL = "postgres://localhost/gym";

describe("run in api mode", () => {
  it("starts the api, logs the port and answers the health check", async () => {
    const { deps, lines, migrate } = makeDeps({ DATABASE_URL, PORT: "38271" });
    const server = await run(deps);
    if (server === null) throw new Error("expected a server");
    servers.push(server);
    await vi.waitFor(() => expect(server.listening).toBe(true));
    const port = (server.address() as AddressInfo).port;
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      msg: "api listening",
      port: 38271,
      mode: "api",
    });
    expect(migrate).not.toHaveBeenCalled();
  });
});

describe("run in migrate mode", () => {
  it("runs the migrations with the migrator url and reports what ran", async () => {
    const { deps, lines, migrate } = makeDeps({
      DATABASE_URL,
      MODE: "migrate",
      MIGRATOR_DATABASE_URL: "postgres://migrator@localhost/gym",
    });
    expect(await run(deps)).toBeNull();
    expect(migrate).toHaveBeenCalledWith("postgres://migrator@localhost/gym");
    expect(JSON.parse(lines[0] ?? "{}")).toEqual({
      msg: "migrations finished",
      ran: ["First1", "Second2"],
    });
  });

  it("refuses to run without the migrator url", async () => {
    const { deps, writeError, exit, migrate } = makeDeps({ DATABASE_URL, MODE: "migrate" });
    await expect(run(deps)).rejects.toThrow(ExitSignal);
    expect(writeError).toHaveBeenCalledWith("MIGRATOR_DATABASE_URL is required when MODE=migrate");
    expect(exit).toHaveBeenCalledWith(1);
    expect(migrate).not.toHaveBeenCalled();
  });

  it("lets a failed migration reject so the process exits non zero", async () => {
    const { deps, migrate } = makeDeps({
      DATABASE_URL,
      MODE: "migrate",
      MIGRATOR_DATABASE_URL: "postgres://migrator@localhost/gym",
    });
    migrate.mockRejectedValueOnce(new Error("migration failed"));
    await expect(run(deps)).rejects.toThrow("migration failed");
  });
});

describe("run in other modes", () => {
  it("refuses a mode that is not implemented yet", async () => {
    const { deps, writeError, exit } = makeDeps({ DATABASE_URL, MODE: "worker" });
    await expect(run(deps)).rejects.toThrow(ExitSignal);
    expect(writeError).toHaveBeenCalledWith("MODE=worker is not implemented yet");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("fails fast on an invalid environment", async () => {
    const { deps, exit } = makeDeps({});
    await expect(run(deps)).rejects.toThrow(ExitSignal);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
