import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateDatabase } from "./migrate";
import { findUnprotectedTenantTables } from "./rls-guard";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "./roles";
import { TENANT_SETTING } from "./tenant-tx";
import { createTestDatabase, type TestDatabase } from "./test-database";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
const INSUFFICIENT_PRIVILEGE = "42501";
const TENANT_TABLES = ["users", "user_roles"];

let db: TestDatabase;
let app: pg.Client;
let migrator: pg.Client;
let tenantA: string;
let tenantB: string;
let userA: string;
let userB: string;

async function codeOf(attempt: Promise<unknown>): Promise<string | undefined> {
  try {
    await attempt;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

/** Runs queries as the app role with one tenant set, in a transaction, like withTenantTx does. */
async function asTenant<T>(tenantId: string | null, body: (client: pg.Client) => Promise<T>) {
  await app.query("BEGIN");
  try {
    if (tenantId !== null) {
      await app.query("SELECT set_config($1, $2, true)", [TENANT_SETTING, tenantId]);
    }
    return await body(app);
  } finally {
    await app.query("ROLLBACK");
  }
}

async function seed(subdomain: string): Promise<{ tenantId: string; userId: string }> {
  const tenant = await db.admin.query(
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $1, 'UTC', 'CAD') RETURNING id",
    [subdomain],
  );
  const tenantId = (tenant.rows[0] as { id: string }).id;
  const user = await db.admin.query(
    "INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id",
    [tenantId, `owner@${subdomain}.test`],
  );
  const userId = (user.rows[0] as { id: string }).id;
  await db.admin.query(
    "INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, 'owner')",
    [tenantId, userId],
  );
  return { tenantId, userId };
}

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  app = await db.connect(APP_ROLE, PASSWORDS.appPassword);
  migrator = await db.connect(MIGRATOR_ROLE, PASSWORDS.migratorPassword);
  ({ tenantId: tenantA, userId: userA } = await seed("gym-a"));
  ({ tenantId: tenantB, userId: userB } = await seed("gym-b"));
});

afterAll(async () => {
  await app.end();
  await migrator.end();
  await db.drop();
});

describe("row level security", () => {
  it("returns zero rows from every tenant table when no tenant is set", async () => {
    for (const table of TENANT_TABLES) {
      const { rows } = await asTenant(null, (client) => client.query(`SELECT * FROM ${table}`));
      expect(rows, table).toEqual([]);
    }
  });

  it("returns zero rows when the tenant setting is empty", async () => {
    const { rows } = await asTenant("", (client) => client.query("SELECT * FROM users"));
    expect(rows).toEqual([]);
  });

  it("lets a tenant read only its own rows", async () => {
    const users = await asTenant(tenantA, (client) => client.query("SELECT id FROM users"));
    expect(users.rows).toEqual([{ id: userA }]);
    const roles = await asTenant(tenantB, (client) =>
      client.query("SELECT user_id FROM user_roles"),
    );
    expect(roles.rows).toEqual([{ user_id: userB }]);
  });

  it("cannot see another tenant's row even when asking for it by id", async () => {
    const { rows } = await asTenant(tenantA, (client) =>
      client.query("SELECT id FROM users WHERE id = $1", [userB]),
    );
    expect(rows).toEqual([]);
  });

  it("cannot update or delete another tenant's rows", async () => {
    await asTenant(tenantA, async (client) => {
      const updated = await client.query("UPDATE users SET name = 'hijacked' WHERE id = $1", [
        userB,
      ]);
      const deleted = await client.query("DELETE FROM user_roles WHERE user_id = $1", [userB]);
      expect([updated.rowCount, deleted.rowCount]).toEqual([0, 0]);
    });
    const { rows } = await db.admin.query("SELECT name FROM users WHERE id = $1", [userB]);
    expect(rows).toEqual([{ name: null }]);
  });

  it("refuses to write a row for another tenant", async () => {
    const attempt = asTenant(tenantA, (client) =>
      client.query("INSERT INTO users (tenant_id, email) VALUES ($1, 'intruder@example.com')", [
        tenantB,
      ]),
    );
    expect(await codeOf(attempt)).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("refuses to move a row to another tenant", async () => {
    const attempt = asTenant(tenantA, (client) =>
      client.query("UPDATE users SET tenant_id = $1 WHERE id = $2", [tenantB, userA]),
    );
    expect(await codeOf(attempt)).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("refuses to write anything when no tenant is set", async () => {
    const attempt = asTenant(null, (client) =>
      client.query("INSERT INTO users (tenant_id, email) VALUES ($1, 'x@example.com')", [tenantA]),
    );
    expect(await codeOf(attempt)).toBe(INSUFFICIENT_PRIVILEGE);
  });

  it("applies to the table owner too, so the migrator sees nothing without a tenant", async () => {
    const { rows } = await migrator.query("SELECT * FROM users");
    expect(rows).toEqual([]);
  });

  it("does not hide the tenants table, which the gym is resolved from before any tenant is set", async () => {
    const { rows } = await app.query("SELECT subdomain FROM tenants ORDER BY subdomain");
    expect(rows).toEqual([{ subdomain: "gym-a" }, { subdomain: "gym-b" }]);
  });
});

describe("findUnprotectedTenantTables", () => {
  it("finds nothing when every table with a tenant_id has a policy", async () => {
    expect(await findUnprotectedTenantTables(db.admin)).toEqual([]);
  });

  it("names a new tenant table that was added without a policy", async () => {
    await migrator.query("CREATE TABLE forgotten (tenant_id uuid NOT NULL, note text)");
    expect(await findUnprotectedTenantTables(db.admin)).toEqual(["forgotten"]);
  });

  it("still names a table that has row level security on but no policy, or no force", async () => {
    await migrator.query("ALTER TABLE forgotten ENABLE ROW LEVEL SECURITY");
    expect(await findUnprotectedTenantTables(db.admin)).toEqual(["forgotten"]);
    await migrator.query("CREATE POLICY p ON forgotten USING (true)");
    expect(await findUnprotectedTenantTables(db.admin)).toEqual(["forgotten"]);
    await migrator.query("ALTER TABLE forgotten FORCE ROW LEVEL SECURITY");
    expect(await findUnprotectedTenantTables(db.admin)).toEqual([]);
  });
});
