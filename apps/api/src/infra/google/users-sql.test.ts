import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { makeGoogleUserDirectory } from "./users-sql";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };

let db: TestDatabase;
let app: pg.Client;
let tenantA: string;
let tenantB: string;

async function tenant(subdomain: string): Promise<string> {
  const { rows } = await app.query(
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $1, 'America/Toronto', 'CAD') RETURNING id",
    [subdomain],
  );
  return (rows[0] as { id: string }).id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  app = await db.connect(APP_ROLE, PASSWORDS.appPassword);
  tenantA = await tenant("gym-a");
  tenantB = await tenant("gym-b");
});

afterAll(async () => {
  await app.end();
  await db.drop();
});

const directory = () =>
  makeGoogleUserDirectory({ query: async (sql, params) => (await app.query(sql, params)).rows });

describe("makeGoogleUserDirectory", () => {
  it("creates a google user the first time a subject signs in", async () => {
    const user = await directory().upsertBySubject(tenantA, {
      subject: "sub-new",
      email: "new@example.com",
      name: "New Member",
    });
    expect(user).toMatchObject({ tenantId: tenantA, email: "new@example.com", name: "New Member" });
    const { rows } = await app.query(
      "SELECT auth_provider, auth_subject FROM users WHERE id = $1",
      [user.id],
    );
    expect(rows[0]).toEqual({ auth_provider: "google", auth_subject: "sub-new" });
  });

  it("keeps the same user when the email on the Google account changes", async () => {
    const first = await directory().upsertBySubject(tenantA, {
      subject: "sub-moved",
      email: "before@example.com",
      name: "Moved",
    });
    const second = await directory().upsertBySubject(tenantA, {
      subject: "sub-moved",
      email: "after@example.com",
      name: null,
    });
    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ email: "after@example.com", name: "Moved" });
    const { rows } = await app.query(
      "SELECT count(*)::int AS n FROM users WHERE tenant_id = $1 AND auth_subject = 'sub-moved'",
      [tenantA],
    );
    expect(rows[0]).toEqual({ n: 1 });
  });

  it("scopes a subject to its tenant, so the same account in another gym is a separate user", async () => {
    const identity = { subject: "sub-shared", email: "shared@example.com", name: "Shared" };
    const inA = await directory().upsertBySubject(tenantA, identity);
    const inB = await directory().upsertBySubject(tenantB, identity);
    expect(inB.id).not.toBe(inA.id);
    expect(inB.tenantId).toBe(tenantB);
  });
});
