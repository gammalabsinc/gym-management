import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeDataSource } from "./data-source";
import { migrateDatabase } from "./migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "./roles";
import { createTestDatabase, type TestDatabase } from "./test-database";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
const UNIQUE_VIOLATION = "23505";
const FK_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const NOT_NULL_VIOLATION = "23502";

let db: TestDatabase;
let app: pg.Client;

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  app = await db.connect(APP_ROLE, PASSWORDS.appPassword);
});

afterAll(async () => {
  await app.end();
  await db.drop();
});

async function codeOf(attempt: Promise<unknown>): Promise<string | undefined> {
  try {
    await attempt;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

async function tenant(subdomain: string): Promise<string> {
  const { rows } = await app.query(
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $2, 'America/Toronto', 'CAD') RETURNING id",
    [`Gym ${subdomain}`, subdomain],
  );
  return (rows[0] as { id: string }).id;
}

async function user(tenantId: string, email: string): Promise<string> {
  const { rows } = await app.query(
    "INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id",
    [tenantId, email],
  );
  return (rows[0] as { id: string }).id;
}

describe("tenants", () => {
  it("applies the documented defaults", async () => {
    const id = await tenant("defaults");
    const { rows } = await app.query(
      "SELECT settings, branding, is_active, meta FROM tenants WHERE id = $1",
      [id],
    );
    expect(rows[0]).toEqual({
      settings: { warn_days_before: 5, red_days_after: 5, dup_window_min: 10 },
      branding: {},
      is_active: true,
      meta: {},
    });
  });

  it("keeps the subdomain unique, the currency an ISO code, and the timezone and name required", async () => {
    await tenant("taken");
    expect(await codeOf(tenant("taken"))).toBe(UNIQUE_VIOLATION);
    const insert = (name: string | null, timezone: string, currency: string, sub: string) =>
      app.query(
        "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $2, $3, $4)",
        [name, sub, timezone, currency],
      );
    expect(await codeOf(insert("G", "bad-currency", "Europe/Paris", "cad"))).toBe(CHECK_VIOLATION);
    expect(await codeOf(insert("G", "no-tz", "", "CAD"))).toBe(CHECK_VIOLATION);
    expect(await codeOf(insert(null, "no-name", "Europe/Paris", "EUR"))).toBe(NOT_NULL_VIOLATION);
  });
});

describe("users", () => {
  it("keeps email unique per tenant but lets the same email exist in two tenants", async () => {
    const a = await tenant("users-a");
    const b = await tenant("users-b");
    await user(a, "sam@example.test");
    await user(b, "sam@example.test");
    expect(await codeOf(user(a, "sam@example.test"))).toBe(UNIQUE_VIOLATION);
  });

  it("stores email lowercase only", async () => {
    const a = await tenant("users-case");
    expect(await codeOf(user(a, "Sam@Example.test"))).toBe(CHECK_VIOLATION);
  });

  it("requires an existing tenant", async () => {
    expect(await codeOf(user("00000000-0000-0000-0000-000000000000", "ghost@example.test"))).toBe(
      FK_VIOLATION,
    );
  });

  it("keeps the auth subject unique per tenant, allowing many unbound users", async () => {
    const a = await tenant("users-sub-a");
    const b = await tenant("users-sub-b");
    const bind = (tenantId: string, email: string, subject: string) =>
      app.query("INSERT INTO users (tenant_id, email, auth_subject) VALUES ($1, $2, $3)", [
        tenantId,
        email,
        subject,
      ]);
    await bind(a, "one@example.test", "google-1");
    await bind(b, "one@example.test", "google-1");
    expect(await codeOf(bind(a, "two@example.test", "google-1"))).toBe(UNIQUE_VIOLATION);
    await user(a, "unbound-1@example.test");
    await user(a, "unbound-2@example.test");
    const { rows } = await app.query(
      "SELECT auth_provider, is_active FROM users WHERE tenant_id = $1 LIMIT 1",
      [a],
    );
    expect(rows[0]).toEqual({ auth_provider: "google", is_active: true });
  });
});

describe("user_roles", () => {
  it("lets one person hold several roles, once each", async () => {
    const a = await tenant("roles-a");
    const id = await user(a, "coach@example.test");
    const grant = (role: string) =>
      app.query("INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
        a,
        id,
        role,
      ]);
    await grant("staff");
    await grant("member");
    expect(await codeOf(grant("staff"))).toBe(UNIQUE_VIOLATION);
    expect(await codeOf(grant("admin"))).toBe(CHECK_VIOLATION);
  });

  it("refuses a link that points at another gym's user", async () => {
    const a = await tenant("roles-cross-a");
    const b = await tenant("roles-cross-b");
    const inA = await user(a, "owner@example.test");
    const crossTenant = app.query(
      "INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, 'owner')",
      [b, inA],
    );
    expect(await codeOf(crossTenant)).toBe(FK_VIOLATION);
  });

  it("refuses to delete a user who still has roles", async () => {
    const a = await tenant("roles-delete");
    const id = await user(a, "keep@example.test");
    await app.query("INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, 'staff')", [
      a,
      id,
    ]);
    expect(await codeOf(app.query("DELETE FROM users WHERE id = $1", [id]))).toBe(FK_VIOLATION);
  });
});

describe("every tenant table", () => {
  it("has tenant_id as a not null uuid, and its unique indexes lead with it", async () => {
    const { rows } = await db.admin.query(`
      SELECT t.table_name, c.data_type, c.is_nullable
      FROM information_schema.tables t
      LEFT JOIN information_schema.columns c
        ON c.table_schema = t.table_schema AND c.table_name = t.table_name AND c.column_name = 'tenant_id'
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND t.table_name NOT IN ('tenants', 'migrations')
      ORDER BY t.table_name`);
    expect(rows).toEqual([
      { table_name: "user_roles", data_type: "uuid", is_nullable: "NO" },
      { table_name: "users", data_type: "uuid", is_nullable: "NO" },
    ]);
    const indexes = await db.admin.query(`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename IN ('users', 'user_roles') AND indexdef LIKE '%UNIQUE%'`);
    const defs = (indexes.rows as { indexdef: string }[]).map((row) => row.indexdef);
    expect(defs).toHaveLength(5);
    for (const def of defs) {
      if (def.includes("users_pkey")) continue;
      expect(def).toMatch(/\(tenant_id, /);
    }
  });
});

describe("the migration", () => {
  it("rolls back cleanly and forward again", async () => {
    const source = makeDataSource(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
    await source.initialize();
    try {
      await source.undoLastMigration({ transaction: "each" });
      const gone = await db.admin.query(
        "SELECT to_regclass('public.users') AS users, to_regclass('public.tenants') AS tenants",
      );
      expect(gone.rows[0]).toEqual({ users: null, tenants: null });
      await source.runMigrations({ transaction: "each" });
      const back = await db.admin.query("SELECT to_regclass('public.user_roles') AS t");
      expect(back.rows[0]).toEqual({ t: "user_roles" });
    } finally {
      await source.destroy();
    }
  });
});
