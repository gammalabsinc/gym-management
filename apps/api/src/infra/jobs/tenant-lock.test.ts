import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminUrl, createTestDatabase, type TestDatabase } from "../db/test-database";
import { makeTenantJobLock } from "./tenant-lock";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let db: TestDatabase;
const pools: pg.Pool[] = [];

beforeAll(async () => {
  db = await createTestDatabase();
});

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
  await db.drop();
});

/** One pool per worker, the way two worker processes would each hold their own connections. */
function worker() {
  const pool = new pg.Pool(connection());
  // An idle connection can be cut when the test database is dropped; that is not a failure here.
  pool.on("error", () => {});
  pools.push(pool);
  return makeTenantJobLock(pool);
}

function connection(): pg.PoolConfig {
  const url = new URL(adminUrl());
  url.pathname = `/${db.name}`;
  return { connectionString: url.toString(), max: 2 };
}

function gate() {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

describe("the gym lock between workers", () => {
  it("runs the work and returns its value when nobody holds the lock", async () => {
    expect(await worker().runExclusive(TENANT_A, async () => 42)).toEqual({ ran: true, value: 42 });
  });

  it("tells a second worker at once that the gym is taken, without running its work", async () => {
    const first = worker();
    const second = worker();
    const holding = gate();
    const release = gate();
    const running = first.runExclusive(TENANT_A, async () => {
      holding.open();
      await release.opened;
      return "first";
    });
    await holding.opened;

    let secondRan = false;
    const refused = await second.runExclusive(TENANT_A, async () => {
      secondRan = true;
      return "second";
    });
    expect(refused).toEqual({ ran: false });
    expect(secondRan).toBe(false);

    release.open();
    expect(await running).toEqual({ ran: true, value: "first" });
    expect(await second.runExclusive(TENANT_A, async () => "second")).toEqual({
      ran: true,
      value: "second",
    });
  });

  it("does not hold gyms against each other", async () => {
    const first = worker();
    const second = worker();
    const holding = gate();
    const release = gate();
    const running = first.runExclusive(TENANT_A, async () => {
      holding.open();
      await release.opened;
    });
    await holding.opened;
    expect(await second.runExclusive(TENANT_B, async () => "b")).toEqual({
      ran: true,
      value: "b",
    });
    release.open();
    await running;
  });

  it("gives the lock back when the work throws, and passes the error on", async () => {
    const first = worker();
    await expect(
      first.runExclusive(TENANT_A, async () => {
        throw new Error("job failed");
      }),
    ).rejects.toThrow("job failed");
    expect(await worker().runExclusive(TENANT_A, async () => "again")).toEqual({
      ran: true,
      value: "again",
    });
  });
});
