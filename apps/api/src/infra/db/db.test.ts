import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataSourceOptions, makeDataSource } from "./data-source";
import { migrateDatabase } from "./migrate";
import { MIGRATIONS } from "./migrations";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "./roles";
import { createTestDatabase, type TestDatabase } from "./test-database";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: 'it\'s "app" pw' };
const INSUFFICIENT_PRIVILEGE = "42501";

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
});

afterAll(async () => {
  await db.drop();
});

const migratorUrl = () => db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword);

async function withClient<T>(
  role: string,
  password: string,
  body: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = await db.connect(role, password);
  try {
    return await body(client);
  } finally {
    await client.end();
  }
}

const asApp = <T>(body: (client: pg.Client) => Promise<T>) =>
  withClient(APP_ROLE, PASSWORDS.appPassword, body);
const asMigrator = <T>(body: (client: pg.Client) => Promise<T>) =>
  withClient(MIGRATOR_ROLE, PASSWORDS.migratorPassword, body);

async function codeOf(attempt: Promise<unknown>): Promise<string | undefined> {
  try {
    await attempt;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("data source options", () => {
  it("never synchronizes the schema and never runs migrations on its own", () => {
    const options = dataSourceOptions("postgres://localhost/gym");
    expect(options.synchronize).toBe(false);
    expect(options.migrationsRun).toBe(false);
    expect(options.migrations).toEqual(MIGRATIONS);
  });

  it("builds one data source per url", () => {
    expect(makeDataSource("postgres://localhost/gym").options.synchronize).toBe(false);
  });
});

describe("provisionRoles", () => {
  it("creates roles with no special powers, and the app role cannot bypass row level security", async () => {
    const { rows } = await db.admin.query(
      `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
       FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname`,
      [[APP_ROLE, MIGRATOR_ROLE]],
    );
    expect(rows).toEqual([
      {
        rolname: APP_ROLE,
        rolcanlogin: true,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
      },
      {
        rolname: MIGRATOR_ROLE,
        rolcanlogin: true,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
      },
    ]);
  });

  it("makes the migrator own the schema", async () => {
    const { rows } = await db.admin.query(
      "SELECT nspowner::regrole::text AS owner FROM pg_namespace WHERE nspname = 'public'",
    );
    expect(rows).toEqual([{ owner: MIGRATOR_ROLE }]);
  });

  it("is safe to run again, and a changed password takes effect", async () => {
    await provisionRoles(db.admin, { ...PASSWORDS, appPassword: "rotated" });
    await withClient(APP_ROLE, "rotated", (client) => client.query("SELECT 1"));
    await provisionRoles(db.admin, PASSWORDS);
    await asApp((client) => client.query("SELECT 1"));
  });
});

describe("migrateDatabase", () => {
  it("runs forward on an empty database and then has nothing left to do", async () => {
    expect(await migrateDatabase(migratorUrl())).toEqual(["GrantAppPrivileges1700000000000"]);
    expect(await migrateDatabase(migratorUrl())).toEqual([]);
    const { rows } = await db.admin.query("SELECT name FROM migrations");
    expect(rows).toEqual([{ name: "GrantAppPrivileges1700000000000" }]);
  });

  it("rejects when the migrator cannot connect, and ends the connection", async () => {
    const wrong = db.urlFor(MIGRATOR_ROLE, "wrong-password");
    await expect(migrateDatabase(wrong)).rejects.toThrow();
  });
});

describe("the app role", () => {
  it("can read and write rows of tables the migrator creates, and use their sequences", async () => {
    await asMigrator((client) =>
      client.query("CREATE TABLE widgets (id serial PRIMARY KEY, name text)"),
    );
    await asApp(async (client) => {
      await client.query("INSERT INTO widgets (name) VALUES ('a')");
      await client.query("UPDATE widgets SET name = 'b'");
      expect((await client.query("SELECT name FROM widgets")).rows).toEqual([{ name: "b" }]);
      await client.query("DELETE FROM widgets");
    });
  });

  it("cannot alter, drop or create tables, or truncate", async () => {
    await asApp(async (client) => {
      expect(await codeOf(client.query("ALTER TABLE widgets ADD COLUMN extra int"))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
      expect(await codeOf(client.query("DROP TABLE widgets"))).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await codeOf(client.query("CREATE TABLE rogue (id int)"))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
      expect(await codeOf(client.query("TRUNCATE widgets"))).toBe(INSUFFICIENT_PRIVILEGE);
    });
  });

  it("cannot touch the migrations table, create roles, or change its own role", async () => {
    await asApp(async (client) => {
      expect(await codeOf(client.query("SELECT * FROM migrations"))).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await codeOf(client.query("CREATE ROLE sneaky"))).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await codeOf(client.query(`ALTER ROLE ${APP_ROLE} BYPASSRLS`))).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
    });
  });
});
