import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectDatabase } from "./connection";
import { APP_ROLE, provisionRoles } from "./roles";
import { createTestDatabase, type TestDatabase } from "./test-database";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
});

afterAll(async () => {
  await db.drop();
});

describe("connectDatabase", () => {
  it("connects as the app role, answers a ping and closes", async () => {
    const database = await connectDatabase(db.urlFor(APP_ROLE, PASSWORDS.appPassword));
    await expect(database.ping()).resolves.toBeUndefined();
    await database.close();
    await expect(database.ping()).rejects.toThrow();
  });

  it("runs a plain transaction that commits, and one that rolls back when it throws", async () => {
    const database = await connectDatabase(db.urlFor(APP_ROLE, PASSWORDS.appPassword));
    try {
      const rows = await database.transact((executor) => executor.query("SELECT 1 AS one", []));
      expect(rows).toEqual([{ one: 1 }]);
      await expect(
        database.transact(async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
    } finally {
      await database.close();
    }
  });

  it("runs a gym scoped transaction with the tenant set", async () => {
    const database = await connectDatabase(db.urlFor(APP_ROLE, PASSWORDS.appPassword));
    try {
      const tenant = await database.withTenantTx("t-1", async (tx) => {
        const rows = (await tx.manager.query("SELECT current_setting('app.tenant_id') AS t")) as {
          t: string;
        }[];
        return rows[0]?.t;
      });
      expect(tenant).toBe("t-1");
    } finally {
      await database.close();
    }
  });

  it("rejects when the database cannot be reached with these credentials", async () => {
    await expect(connectDatabase(db.urlFor(APP_ROLE, "wrong-password"))).rejects.toThrow();
  });
});
