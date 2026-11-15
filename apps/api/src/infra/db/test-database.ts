import { randomUUID } from "node:crypto";
import pg from "pg";

/** A throwaway database on the real Postgres that CI provides in DATABASE_URL. Test support only. */
export interface TestDatabase {
  readonly name: string;
  /** Connection string for a role of this database. */
  urlFor(role: string, password: string): string;
  /** A connected pg client for a role. The caller ends it. */
  connect(role: string, password: string): Promise<pg.Client>;
  /** A superuser client on the throwaway database, used for provisioning. */
  admin: pg.Client;
  drop(): Promise<void>;
}

/**
 * Roles belong to the whole cluster, not to one database, so two test files that set a password on
 * gym_app at the same time break each other. Each file holds this lock for its whole life.
 */
const ROLE_LOCK_KEY = 7_340_001;

export function adminUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === "") {
    throw new Error("DATABASE_URL must point at a Postgres superuser for the database tests");
  }
  return url;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const base = new URL(adminUrl());
  const name = `gym_d1_${randomUUID().replaceAll("-", "")}`;
  const maintenance = new pg.Client({ connectionString: base.toString() });
  await maintenance.connect();
  await maintenance.query("SELECT pg_advisory_lock($1)", [ROLE_LOCK_KEY]);
  await maintenance.query(`CREATE DATABASE ${name}`);

  const withRole = (role: string, password: string): string => {
    const url = new URL(base.toString());
    url.username = role;
    url.password = password;
    url.pathname = `/${name}`;
    return url.toString();
  };
  const adminConnection = new URL(base.toString());
  adminConnection.pathname = `/${name}`;
  const admin = new pg.Client({ connectionString: adminConnection.toString() });
  await admin.connect();

  return {
    name,
    urlFor: withRole,
    admin,
    async connect(role, password) {
      const client = new pg.Client({ connectionString: withRole(role, password) });
      await client.connect();
      return client;
    },
    async drop() {
      await admin.end();
      await maintenance.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await maintenance.query("SELECT pg_advisory_unlock($1)", [ROLE_LOCK_KEY]);
      await maintenance.end();
    },
  };
}
