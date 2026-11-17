import { describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn(async (_deps: unknown) => null));
const migrateDatabase = vi.hoisted(() => vi.fn());
const connectDatabase = vi.hoisted(() => vi.fn());
const onboardGym = vi.hoisted(() => vi.fn());
const runInvoiceTopUp = vi.hoisted(() => vi.fn());
vi.mock("./run", () => ({ run }));
vi.mock("../infra/db/migrate", () => ({ migrateDatabase }));
vi.mock("../infra/db/connection", () => ({ connectDatabase }));
vi.mock("./onboard", () => ({ onboardGym }));
vi.mock("./worker", () => ({ runInvoiceTopUp }));

describe("entry point", () => {
  it("runs with the process environment, stdio, the real migrator, the real onboarding and the real worker", async () => {
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
      onboard: unknown;
      worker: unknown;
      onSignal: (signal: string, handler: () => void) => void;
    };
    expect(deps.env).toBe(process.env);
    expect(deps.migrate).toBe(migrateDatabase);
    expect(deps.connect).toBe(connectDatabase);
    expect(deps.onboard).toBe(onboardGym);
    expect(deps.worker).toBe(runInvoiceTopUp);
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
