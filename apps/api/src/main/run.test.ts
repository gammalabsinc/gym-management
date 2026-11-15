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
  const database = { ping: vi.fn(async () => {}), close: vi.fn(async () => {}) };
  const connect = vi.fn(async (_url: string) => database);
  const handlers = new Map<string, () => void>();
  const onSignal = vi.fn((signal: string, handler: () => void) => {
    handlers.set(signal, handler);
  });
  return {
    deps: {
      env,
      write: (line: string) => lines.push(line),
      writeError,
      exit,
      migrate,
      connect,
      onSignal,
    },
    database,
    connect,
    handlers,
    lines,
    writeError,
    exit,
    migrate,
  };
}

const exitCodes: number[] = [];

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

  it("connects to the database with the app url before listening", async () => {
    const { deps, connect } = makeDeps({ DATABASE_URL, PORT: "38272" });
    const server = await run(deps);
    if (server !== null) servers.push(server);
    expect(connect).toHaveBeenCalledWith(DATABASE_URL);
  });

  it("reports ready while the database answers and not ready when it does not", async () => {
    const { deps, database } = makeDeps({ DATABASE_URL, PORT: "38273" });
    const server = await run(deps);
    if (server === null) throw new Error("expected a server");
    servers.push(server);
    await vi.waitFor(() => expect(server.listening).toBe(true));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/readyz`;
    expect((await fetch(url)).status).toBe(200);
    database.ping.mockRejectedValueOnce(new Error("db down"));
    expect((await fetch(url)).status).toBe(503);
  });

  it("drains on SIGTERM: not ready, closes the pool, then exits 0", async () => {
    const { deps, database, handlers, lines } = makeDeps({ DATABASE_URL, PORT: "38274" });
    deps.exit = vi.fn((code: number): never => {
      exitCodes.push(code);
      return undefined as never;
    });
    const server = await run(deps);
    if (server === null) throw new Error("expected a server");
    await vi.waitFor(() => expect(server.listening).toBe(true));
    handlers.get("SIGTERM")?.();
    await vi.waitFor(() => expect(exitCodes).toContain(0));
    expect(database.close).toHaveBeenCalledTimes(1);
    expect(server.listening).toBe(false);
    expect(lines.some((line) => line.includes("SIGTERM received, draining"))).toBe(true);
  });

  it("also drains on SIGINT", async () => {
    const { deps, handlers } = makeDeps({ DATABASE_URL, PORT: "38275" });
    deps.exit = vi.fn((code: number): never => {
      exitCodes.push(code);
      return undefined as never;
    });
    const server = await run(deps);
    if (server === null) throw new Error("expected a server");
    await vi.waitFor(() => expect(server.listening).toBe(true));
    exitCodes.length = 0;
    handlers.get("SIGINT")?.();
    await vi.waitFor(() => expect(exitCodes).toContain(0));
  });

  it("does not start when the database cannot be reached", async () => {
    const { deps } = makeDeps({ DATABASE_URL, PORT: "38276" });
    deps.connect = vi.fn(async () => {
      throw new Error("connection refused");
    });
    await expect(run(deps)).rejects.toThrow("connection refused");
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
