import { describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn(async (_deps: unknown) => null));
const migrateDatabase = vi.hoisted(() => vi.fn());
const connectDatabase = vi.hoisted(() => vi.fn());
vi.mock("./run", () => ({ run }));
vi.mock("../infra/db/migrate", () => ({ migrateDatabase }));
vi.mock("../infra/db/connection", () => ({ connectDatabase }));

describe("entry point", () => {
  it("runs with the process environment, stdio and the real migrator", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await import("./index");
    const deps = run.mock.calls[0]?.[0] as {
      env: unknown;
      write: (line: string) => void;
      writeError: (message: string) => void;
      exit: (code: number) => void;
      migrate: unknown;
      connect: unknown;
      onSignal: (signal: string, handler: () => void) => void;
    };
    expect(deps.env).toBe(process.env);
    expect(deps.migrate).toBe(migrateDatabase);
    expect(deps.connect).toBe(connectDatabase);
    const once = vi.spyOn(process, "once").mockImplementation((() => process) as never);
    const handler = () => {};
    deps.onSignal("SIGTERM", handler);
    expect(once).toHaveBeenCalledWith("SIGTERM", handler);
    deps.write("line");
    deps.writeError("problem");
    deps.exit(2);
    expect(stdout).toHaveBeenCalledWith("line\n");
    expect(stderr).toHaveBeenCalledWith("problem\n");
    expect(exit).toHaveBeenCalledWith(2);
    vi.restoreAllMocks();
  });
});
