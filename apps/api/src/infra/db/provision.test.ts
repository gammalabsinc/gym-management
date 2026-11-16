import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { provisionDatabase } from "./provision";
import { APP_ROLE, MIGRATOR_ROLE } from "./roles";
import { adminUrl, createTestDatabase, type TestDatabase } from "./test-database";

const PASSWORDS = { migratorPassword: "migrator-pw-0123456789", appPassword: "app-pw-0123456789" };

let db: TestDatabase;
let adminDatabaseUrl: string;

beforeAll(async () => {
  db = await createTestDatabase();
  const url = new URL(adminUrl());
  url.pathname = `/${db.name}`;
  adminDatabaseUrl = url.toString();
});

afterAll(async () => {
  await db.drop();
});

describe("provisionDatabase", () => {
  it("creates both roles so each can log in with its own password", async () => {
    await provisionDatabase(adminDatabaseUrl, PASSWORDS);
    for (const [role, password] of [
      [MIGRATOR_ROLE, PASSWORDS.migratorPassword],
      [APP_ROLE, PASSWORDS.appPassword],
    ] as const) {
      const client = await db.connect(role, password);
      const result = await client.query("SELECT current_user AS who");
      expect(result.rows[0]?.who).toBe(role);
      await client.end();
    }
  });

  it("can run again and rotates the passwords", async () => {
    const rotated = { ...PASSWORDS, appPassword: "rotated-app-pw-0123456789" };
    await provisionDatabase(adminDatabaseUrl, rotated);
    const client = await db.connect(APP_ROLE, rotated.appPassword);
    await client.end();
    await expect(db.connect(APP_ROLE, PASSWORDS.appPassword)).rejects.toThrow();
  });

  it("rejects when the database cannot be reached and ends cleanly", async () => {
    await expect(
      provisionDatabase("postgres://postgres:wrong@127.0.0.1:1/none", PASSWORDS),
    ).rejects.toThrow();
  });

  it("closes the connection when provisioning fails", async () => {
    await expect(
      provisionDatabase(db.urlFor(APP_ROLE, "rotated-app-pw-0123456789"), PASSWORDS),
    ).rejects.toThrow();
  });
});
