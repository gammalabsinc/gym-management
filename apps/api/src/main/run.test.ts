import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BackfillReport } from "../app/backfill";
import type { TopUpSummary } from "../app/invoice-top-up";
import type { OnboardedGym } from "../app/onboarding";
import type { SeededGym } from "../app/seed-dev-data";
import type { ValidationError } from "../domain/errors";
import { validationError } from "../domain/errors";
import type { OnboardGymInput } from "../domain/onboarding";
import { ok, type Result } from "../domain/result";
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
  const provision = vi.fn(async (_url: string, _passwords: unknown): Promise<void> => {});
  const database = {
    ping: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    transact: vi.fn(async () => {
      throw new Error("not used here");
    }),
    withTenantTx: vi.fn(async () => {
      throw new Error("not used here");
    }),
  };
  const connect = vi.fn(async (_url: string) => database);
  const onboard = vi.fn(
    async (_url: string, _input: OnboardGymInput): Promise<Result<OnboardedGym, ValidationError>> =>
      ok({ tenantId: "tenant-1", subdomain: "iron-works", created: true }),
  );
  const seed = vi.fn(
    async (_url: string): Promise<readonly SeededGym[]> => [
      { subdomain: "ironworks", tenantId: "tenant-1", created: true, members: 6 },
      { subdomain: "pulsefit", tenantId: "tenant-2", created: false, members: 0 },
    ],
  );
  const backfill = vi.fn(
    async (_url: string, _options: unknown): Promise<Result<BackfillReport, ValidationError>> =>
      ok({
        members: [
          {
            email: "ada@example.test",
            outcome: "created",
            statusChanges: 1,
            invoices: 4,
            payments: 2,
            paymentsSkipped: 0,
            discounts: 1,
            problem: null,
          },
        ],
      }),
  );
  const worker = vi.fn(
    async (_url: string, _logger: unknown): Promise<TopUpSummary> => ({
      tenants: 2,
      skippedTenants: 0,
      failedTenants: 0,
      invoices: 3,
      failedMembers: 0,
    }),
  );
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
      provision,
      onboard,
      seed,
      backfill,
      worker,
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
    provision,
    onboard,
    seed,
    backfill,
    worker,
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
    const { deps, lines, migrate } = makeDeps({
      DATABASE_URL,
      PORT: "38271",
      GOOGLE_CLIENT_IDS: "ios.apps.test",
    });
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

  it("warns at boot when no Google client id is set, and still starts", async () => {
    const { deps, lines } = makeDeps({ DATABASE_URL, PORT: "38273" });
    const server = await run(deps);
    if (server === null) throw new Error("expected a server");
    servers.push(server);
    const parsed = lines.map((line) => JSON.parse(line) as { msg: string; level?: string });
    expect(parsed[0]).toMatchObject({
      msg: "GOOGLE_CLIENT_IDS is not set, so every sign in is refused",
      level: "warn",
    });
    await vi.waitFor(() => expect(server.listening).toBe(true));
    await vi.waitFor(() =>
      expect(lines.map((line) => (JSON.parse(line) as { msg: string }).msg)).toContain(
        "api listening",
      ),
    );
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

describe("run in provision mode", () => {
  const passwordEnv = {
    MIGRATOR_ROLE_PASSWORD: "migrator-password-0123",
    APP_ROLE_PASSWORD: "app-password-01234567",
  };

  it("sets the role passwords through the administrator url and reports it", async () => {
    const { deps, lines, provision, connect } = makeDeps({
      DATABASE_URL,
      MODE: "provision",
      ...passwordEnv,
    });
    expect(await run(deps)).toBeNull();
    expect(provision).toHaveBeenCalledWith(DATABASE_URL, {
      migratorPassword: passwordEnv.MIGRATOR_ROLE_PASSWORD,
      appPassword: passwordEnv.APP_ROLE_PASSWORD,
    });
    expect(JSON.parse(lines[0] ?? "{}")).toEqual({ msg: "roles provisioned" });
    expect(lines.join("")).not.toContain(passwordEnv.APP_ROLE_PASSWORD);
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([
    ["no passwords", {}],
    ["only the migrator password", { MIGRATOR_ROLE_PASSWORD: passwordEnv.MIGRATOR_ROLE_PASSWORD }],
    ["only the app password", { APP_ROLE_PASSWORD: passwordEnv.APP_ROLE_PASSWORD }],
  ])("refuses to run with %s", async (_name, extra) => {
    const { deps, writeError, exit, provision } = makeDeps({
      DATABASE_URL,
      MODE: "provision",
      ...extra,
    });
    await expect(run(deps)).rejects.toThrow(ExitSignal);
    expect(writeError).toHaveBeenCalledWith(
      "MIGRATOR_ROLE_PASSWORD and APP_ROLE_PASSWORD are required when MODE=provision",
    );
    expect(exit).toHaveBeenCalledWith(1);
    expect(provision).not.toHaveBeenCalled();
  });

  it("lets a failed provision reject so the process exits non zero", async () => {
    const { deps, provision } = makeDeps({ DATABASE_URL, MODE: "provision", ...passwordEnv });
    provision.mockRejectedValueOnce(new Error("permission denied"));
    await expect(run(deps)).rejects.toThrow("permission denied");
  });
});

describe("run in onboard mode", () => {
  const gymEnv = {
    GYM_NAME: "Iron Works",
    GYM_SUBDOMAIN: "iron-works",
    GYM_TIMEZONE: "America/Toronto",
    GYM_CURRENCY: "CAD",
    OWNER_EMAIL: "owner@example.test",
  };

  it("adds the gym through the app url and reports the new gym", async () => {
    const { deps, lines, onboard, connect } = makeDeps({
      DATABASE_URL,
      MODE: "onboard",
      ...gymEnv,
      OWNER_NAME: "Sam Owner",
      ADMISSION_FEE: "2000",
      MONTHLY_FEE: "5000",
    });
    expect(await run(deps)).toBeNull();
    expect(onboard).toHaveBeenCalledWith(DATABASE_URL, {
      name: "Iron Works",
      subdomain: "iron-works",
      timezone: "America/Toronto",
      currency: "CAD",
      ownerEmail: "owner@example.test",
      ownerName: "Sam Owner",
      admissionFee: 2000,
      monthlyFee: 5000,
    });
    expect(JSON.parse(lines[0] ?? "{}")).toEqual({
      msg: "gym created",
      tenantId: "tenant-1",
      subdomain: "iron-works",
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("says so when the gym was already there", async () => {
    const { deps, lines, onboard } = makeDeps({ DATABASE_URL, MODE: "onboard", ...gymEnv });
    onboard.mockResolvedValueOnce(ok({ tenantId: "t", subdomain: "iron-works", created: false }));
    expect(await run(deps)).toBeNull();
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ msg: "gym already exists" });
  });

  it.each([
    ["no gym variables", {}],
    ["no owner email", { ...gymEnv, OWNER_EMAIL: undefined }],
    ["no subdomain", { ...gymEnv, GYM_SUBDOMAIN: undefined }],
  ])("refuses to run with %s", async (_name, extra) => {
    const { deps, writeError, exit, onboard } = makeDeps({
      DATABASE_URL,
      MODE: "onboard",
      ...extra,
    });
    await expect(run(deps)).rejects.toThrow(ExitSignal);
    expect(writeError).toHaveBeenCalledWith(
      "GYM_NAME, GYM_SUBDOMAIN, GYM_TIMEZONE, GYM_CURRENCY and OWNER_EMAIL are required when MODE=onboard",
    );
    expect(exit).toHaveBeenCalledWith(1);
    expect(onboard).not.toHaveBeenCalled();
  });

  it("prints every problem with the input and exits non zero", async () => {
    const { deps, writeError, exit, onboard } = makeDeps({
      DATABASE_URL,
      MODE: "onboard",
      ...gymEnv,
    });
    onboard.mockResolvedValueOnce(
      validationError("Invalid gym", [
        { path: ["subdomain"], message: "Use lower case letters" },
        { path: ["currency"], message: "Use a three letter code" },
      ]),
    );
    await expect(run(deps)).rejects.toThrow(ExitSignal);
    expect(writeError).toHaveBeenCalledWith(
      "Invalid gym:\n  subdomain: Use lower case letters\n  currency: Use a three letter code",
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("lets a failed onboarding reject so the process exits non zero", async () => {
    const { deps, onboard } = makeDeps({ DATABASE_URL, MODE: "onboard", ...gymEnv });
    onboard.mockRejectedValueOnce(new Error("connection refused"));
    await expect(run(deps)).rejects.toThrow("connection refused");
  });
});

describe("run in seed mode", () => {
  it("seeds with the app role url and reports each gym", async () => {
    const { deps, seed, lines, exit } = makeDeps({ DATABASE_URL, MODE: "seed" });
    expect(await run(deps)).toBeNull();
    expect(seed).toHaveBeenCalledWith(DATABASE_URL);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { msg: "gym seeded", subdomain: "ironworks", tenantId: "tenant-1", members: 6 },
      { msg: "gym already seeded", subdomain: "pulsefit", tenantId: "tenant-2", members: 0 },
    ]);
    expect(exit).not.toHaveBeenCalled();
  });

  it("refuses to run when NODE_ENV is production and touches nothing", async () => {
    const { deps, seed, writeError, exit, connect } = makeDeps({
      DATABASE_URL,
      MODE: "seed",
      NODE_ENV: "production",
    });
    await expect(run(deps)).rejects.toThrow("exit 1");
    expect(writeError).toHaveBeenCalledWith("The dev seed never runs when NODE_ENV is production");
    expect(exit).toHaveBeenCalledWith(1);
    expect(seed).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it("lets a failed seed reject so the process exits non zero", async () => {
    const { deps, seed } = makeDeps({ DATABASE_URL, MODE: "seed" });
    seed.mockRejectedValueOnce(new Error("connection refused"));
    await expect(run(deps)).rejects.toThrow("connection refused");
  });
});

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const BACKFILL_ENV = {
  DATABASE_URL,
  MODE: "backfill",
  BACKFILL_TENANT_ID: TENANT_ID,
  BACKFILL_FILE: "members.json",
};

describe("run in backfill mode", () => {
  it("loads the file for the gym and reports each member", async () => {
    const { deps, backfill, lines, exit } = makeDeps(BACKFILL_ENV);
    expect(await run(deps)).toBeNull();
    expect(backfill).toHaveBeenCalledWith(DATABASE_URL, {
      tenantId: TENANT_ID,
      file: "members.json",
      dryRun: false,
    });
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      {
        msg: "backfill",
        email: "ada@example.test",
        outcome: "created",
        statusChanges: 1,
        invoices: 4,
        payments: 2,
        paymentsSkipped: 0,
        discounts: 1,
        problem: null,
      },
    ]);
    expect(exit).not.toHaveBeenCalled();
  });

  it("says so on every line of a dry run", async () => {
    const { deps, backfill, lines } = makeDeps({ ...BACKFILL_ENV, BACKFILL_DRY_RUN: "true" });
    await run(deps);
    expect(backfill).toHaveBeenCalledWith(DATABASE_URL, expect.objectContaining({ dryRun: true }));
    expect(JSON.parse(lines[0] ?? "{}").msg).toBe("backfill dry run");
  });

  it("needs the gym and the file", async () => {
    const { deps, backfill, writeError } = makeDeps({ DATABASE_URL, MODE: "backfill" });
    await expect(run(deps)).rejects.toThrow("exit 1");
    expect(writeError).toHaveBeenCalledWith(
      "BACKFILL_TENANT_ID and BACKFILL_FILE are required when MODE=backfill",
    );
    expect(backfill).not.toHaveBeenCalled();
  });

  it("prints every problem of an invalid file and exits non zero", async () => {
    const { deps, backfill, writeError } = makeDeps(BACKFILL_ENV);
    backfill.mockResolvedValueOnce(
      validationError("Invalid backfill", [
        { path: ["members", 0, "joinDate"], message: "Cannot be in the future" },
      ]),
    );
    await expect(run(deps)).rejects.toThrow("exit 1");
    expect(writeError).toHaveBeenCalledWith(
      "Invalid backfill:\n  members.0.joinDate: Cannot be in the future",
    );
  });

  it("exits non zero when a member was not loaded", async () => {
    const { deps, backfill, writeError, lines } = makeDeps(BACKFILL_ENV);
    backfill.mockResolvedValueOnce(
      ok({
        members: [
          {
            email: "bo@example.test",
            outcome: "failed",
            statusChanges: 0,
            invoices: 0,
            payments: 0,
            paymentsSkipped: 0,
            discounts: 0,
            problem: "The referral source ada@example.test is not a member yet",
          },
        ],
      }),
    );
    await expect(run(deps)).rejects.toThrow("exit 1");
    expect(lines).toHaveLength(1);
    expect(writeError).toHaveBeenCalledWith("1 member(s) were not loaded, see the log");
  });
});

describe("run in worker mode", () => {
  it("runs the invoice job once with a logger, writes the summary and exits normally", async () => {
    const { deps, worker, lines, exit } = makeDeps({ DATABASE_URL, MODE: "worker" });
    expect(await run(deps)).toBeNull();
    expect(worker).toHaveBeenCalledTimes(1);
    expect(worker.mock.calls[0]?.[0]).toBe(DATABASE_URL);
    expect(JSON.parse(lines.at(-1) ?? "{}")).toEqual({
      msg: "invoice top up finished",
      tenants: 2,
      skippedTenants: 0,
      failedTenants: 0,
      invoices: 3,
      failedMembers: 0,
    });
    expect(exit).not.toHaveBeenCalled();
  });

  it("gives the job a logger that writes JSON lines through the same output", async () => {
    const { deps, worker, lines } = makeDeps({ DATABASE_URL, MODE: "worker", LOG_LEVEL: "info" });
    worker.mockImplementationOnce(async (_url, logger) => {
      (logger as { info(message: string): void }).info("hello from the job");
      return { tenants: 0, skippedTenants: 0, failedTenants: 0, invoices: 0, failedMembers: 0 };
    });
    await run(deps);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ msg: "hello from the job" });
  });

  it("exits non zero when a gym failed, after writing the summary", async () => {
    const { deps, worker, lines, writeError, exit } = makeDeps({ DATABASE_URL, MODE: "worker" });
    worker.mockResolvedValueOnce({
      tenants: 2,
      skippedTenants: 0,
      failedTenants: 1,
      invoices: 1,
      failedMembers: 2,
    });
    await expect(run(deps)).rejects.toThrow(ExitSignal);
    expect(JSON.parse(lines.at(-1) ?? "{}")).toMatchObject({ failedTenants: 1, failedMembers: 2 });
    expect(writeError).toHaveBeenCalledWith("Invoice top up failed for 1 gym(s), see the log");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("lets a job that cannot even start reject, so the process exits non zero", async () => {
    const { deps, worker } = makeDeps({ DATABASE_URL, MODE: "worker" });
    worker.mockRejectedValueOnce(new Error("connection refused"));
    await expect(run(deps)).rejects.toThrow("connection refused");
  });
});

describe("run in other modes", () => {
  it("fails fast on an invalid environment", async () => {
    const { deps, exit } = makeDeps({});
    await expect(run(deps)).rejects.toThrow(ExitSignal);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
