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

  it("rejects when the database cannot be reached with these credentials", async () => {
    await expect(connectDatabase(db.urlFor(APP_ROLE, "wrong-password"))).rejects.toThrow();
  });
});
