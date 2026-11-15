import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataSourceOptions } from "./data-source";
import { APP_ROLE, provisionRoles } from "./roles";
import { makeWithTenantTx, requireTenantTx, TENANT_SETTING, type TenantTx } from "./tenant-tx";
import { createTestDatabase, type TestDatabase } from "./test-database";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };

let db: TestDatabase;
let oneConnection: DataSource;
let twoConnections: DataSource;

function sourceWithPool(max: number): DataSource {
  const url = db.urlFor(APP_ROLE, PASSWORDS.appPassword);
  return new DataSource({ ...dataSourceOptions(url), extra: { max } });
}

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  oneConnection = sourceWithPool(1);
  twoConnections = sourceWithPool(2);
  await Promise.all([oneConnection.initialize(), twoConnections.initialize()]);
});

afterAll(async () => {
  await Promise.all([oneConnection.destroy(), twoConnections.destroy()]);
  await db.drop();
});

async function setting(source: { query(sql: string, params?: unknown[]): Promise<unknown> }) {
  const rows = (await source.query("SELECT current_setting($1, true) AS value", [
    TENANT_SETTING,
  ])) as { value: string | null }[];
  return rows[0]?.value ?? null;
}

describe("withTenantTx", () => {
  it("sets the tenant for the transaction and hands over the manager", async () => {
    const withTenantTx = makeWithTenantTx(oneConnection);
    const seen = await withTenantTx("tenant-a", async (tx) => ({
      id: tx.tenantId,
      value: await setting(tx.manager),
    }));
    expect(seen).toEqual({ id: "tenant-a", value: "tenant-a" });
  });

  it("does not leak the tenant to the next user of the same pooled connection", async () => {
    const withTenantTx = makeWithTenantTx(oneConnection);
    await withTenantTx("tenant-a", async () => {});
    // The pool holds one connection, so this query runs on the connection tenant-a just used.
    expect(await setting(oneConnection)).toBeFalsy();
    const second = await withTenantTx("tenant-b", (tx) => setting(tx.manager));
    expect(second).toBe("tenant-b");
    expect(await setting(oneConnection)).toBeFalsy();
  });

  it("does not leak the tenant after a rollback, and rethrows the original error", async () => {
    const withTenantTx = makeWithTenantTx(oneConnection);
    const failure = new Error("boom");
    await expect(
      withTenantTx("tenant-a", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await setting(oneConnection)).toBeFalsy();
  });

  it("keeps two concurrent tenants apart", async () => {
    const withTenantTx = makeWithTenantTx(twoConnections);
    const read = (tenant: string) =>
      withTenantTx(tenant, async (tx) => {
        await tx.manager.query("SELECT pg_sleep(0.05)");
        return setting(tx.manager);
      });
    expect(await Promise.all([read("tenant-a"), read("tenant-b")])).toEqual([
      "tenant-a",
      "tenant-b",
    ]);
  });

  it("passes the tenant id as a parameter, so odd characters cannot break out", async () => {
    const withTenantTx = makeWithTenantTx(oneConnection);
    const odd = "x'); DROP TABLE users; --";
    expect(await withTenantTx(odd, (tx) => setting(tx.manager))).toBe(odd);
  });

  it("refuses a missing or oversized tenant id before touching the database", async () => {
    const withTenantTx = makeWithTenantTx(oneConnection);
    for (const bad of ["", "   ", "x".repeat(65)]) {
      await expect(withTenantTx(bad, async () => 1)).rejects.toThrow(RangeError);
    }
  });
});

describe("TenantTx handles", () => {
  const makeRepo = (tx: TenantTx) => {
    requireTenantTx(tx);
    return { tenantId: tx.tenantId, find: () => setting(tx.manager) };
  };

  it("build repositories only inside withTenantTx", async () => {
    const withTenantTx = makeWithTenantTx(oneConnection);
    const found = await withTenantTx("tenant-a", (tx) => makeRepo(tx).find());
    expect(found).toBe("tenant-a");
  });

  it("refuse a forged handle", () => {
    const forged = { tenantId: "tenant-a", manager: oneConnection.manager } as unknown as TenantTx;
    expect(() => makeRepo(forged)).toThrow("only be built inside withTenantTx");
  });

  it("refuse a manager where a handle is expected, at compile time", () => {
    const check = () => {
      // @ts-expect-error a bare EntityManager is not a TenantTx
      makeRepo(oneConnection.manager);
    };
    expect(typeof check).toBe("function");
  });

  it("stop working once the transaction has ended", async () => {
    const withTenantTx = makeWithTenantTx(oneConnection);
    const kept = await withTenantTx("tenant-a", async (tx) => tx);
    expect(() => kept.manager).toThrow("has ended");
    expect(() => requireTenantTx(kept)).toThrow("only be built inside withTenantTx");
  });
});
