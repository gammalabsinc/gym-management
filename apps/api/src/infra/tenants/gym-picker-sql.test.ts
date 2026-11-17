import { randomUUID } from "node:crypto";
import type pg from "pg";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type GymPickerDeps, makeListMyGyms } from "../../app/gym-picker";
import type { Role } from "../../domain/permissions";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { makeWithTenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { makeAccountLookup, type RunInTransaction } from "../google/accounts-sql";
import { makeWithGymPickerUnit } from "./gym-picker-unit";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };

let db: TestDatabase;
let app: pg.Client;
let source: DataSource;
let deps: GymPickerDeps;
let counter = 0;

/** One transaction on the app role's connection, the way the API runs an identity session read. */
const transact: RunInTransaction = async (fn) => {
  await app.query("BEGIN");
  try {
    const result = await fn({ query: async (sql, params) => (await app.query(sql, params)).rows });
    await app.query("COMMIT");
    return result;
  } catch (error) {
    await app.query("ROLLBACK");
    throw error;
  }
};

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  app = await db.connect(APP_ROLE, PASSWORDS.appPassword);
  source = new DataSource({
    ...dataSourceOptions(db.urlFor(APP_ROLE, PASSWORDS.appPassword)),
    extra: { max: 4 },
  });
  await source.initialize();
  deps = {
    accounts: makeAccountLookup(transact),
    withUnit: makeWithGymPickerUnit(makeWithTenantTx(source)),
  };
});

afterAll(async () => {
  await source.destroy();
  await app.end();
  await db.drop();
});

async function one(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await db.admin.query(sql, params);
  return (rows[0] as { id: string }).id;
}

interface GymOptions {
  name?: string;
  logoUrl?: string;
  isActive?: boolean;
}

async function gym(options: GymOptions = {}): Promise<string> {
  counter += 1;
  const name = options.name ?? `Gym ${counter}`;
  return one(
    `INSERT INTO tenants (name, subdomain, timezone, currency, branding, is_active)
     VALUES ($1, $2, 'America/Toronto', 'CAD', $3::jsonb, $4) RETURNING id`,
    [
      name,
      `gym-${counter}`,
      JSON.stringify(options.logoUrl === undefined ? {} : { logo_url: options.logoUrl }),
      options.isActive ?? true,
    ],
  );
}

interface PersonOptions {
  subject?: string | null;
  isActive?: boolean;
}

async function person(
  tenantId: string,
  roles: Role[],
  options: PersonOptions = {},
): Promise<string> {
  counter += 1;
  const userId = await one(
    `INSERT INTO users (tenant_id, email, auth_subject, is_active)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, `person-${counter}@example.test`, options.subject ?? null, options.isActive ?? true],
  );
  for (const role of roles) {
    await db.admin.query("INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
      tenantId,
      userId,
      role,
    ]);
  }
  return userId;
}

const list = () => makeListMyGyms(deps);

describe("the gym picker on a real database", () => {
  it("returns only the gyms where the person holds a role, with their roles, sorted by name", async () => {
    const subject = `sub-${randomUUID()}`;
    const bravo = await gym({ name: "Bravo Gym" });
    const alpha = await gym({ name: "Alpha Gym", logoUrl: "https://example.test/logo.png" });
    await person(bravo, ["member"], { subject });
    await person(alpha, ["staff", "owner"], { subject });

    const noRole = await gym({ name: "No Role Gym" });
    await person(noRole, [], { subject });
    const switchedOffUser = await gym({ name: "Switched Off User Gym" });
    await person(switchedOffUser, ["member"], { subject, isActive: false });
    const switchedOffGym = await gym({ name: "Switched Off Gym", isActive: false });
    await person(switchedOffGym, ["owner"], { subject });

    const result = await list()(undefined, { subject });
    expect(result.ok && result.value).toEqual([
      {
        tenantId: alpha,
        name: "Alpha Gym",
        subdomain: expect.stringMatching(/^gym-\d+$/),
        logoUrl: "https://example.test/logo.png",
        roles: ["owner", "staff"],
      },
      {
        tenantId: bravo,
        name: "Bravo Gym",
        subdomain: expect.stringMatching(/^gym-\d+$/),
        logoUrl: null,
        roles: ["member"],
      },
    ]);
  });

  it("shows no tenant internals beyond the id, name, subdomain, logo and the person's roles", async () => {
    const subject = `sub-${randomUUID()}`;
    await person(await gym(), ["owner"], { subject });
    const result = await list()(undefined, { subject });
    expect(result.ok && Object.keys(result.value[0] ?? {}).sort()).toEqual([
      "logoUrl",
      "name",
      "roles",
      "subdomain",
      "tenantId",
    ]);
  });

  it("never shows another person's gyms, and never links a row that waits for an email", async () => {
    const mine = `sub-${randomUUID()}`;
    const theirs = `sub-${randomUUID()}`;
    const myGym = await gym();
    const theirGym = await gym();
    await person(myGym, ["member"], { subject: mine });
    await person(theirGym, ["owner"], { subject: theirs });
    const waiting = await person(theirGym, ["staff"]);

    const result = await list()(undefined, { subject: mine });
    expect(result.ok && result.value.map((g) => g.tenantId)).toEqual([myGym]);

    const { rows } = await db.admin.query("SELECT auth_subject FROM users WHERE id = $1", [
      waiting,
    ]);
    expect((rows[0] as { auth_subject: string | null }).auth_subject).toBeNull();
  });

  it("returns an empty list for a subject that no row belongs to", async () => {
    const result = await list()(undefined, { subject: `sub-${randomUUID()}` });
    expect(result).toEqual({ ok: true, value: [] });
  });

  it("cannot read a user of another gym from inside a gym's transaction", async () => {
    const subject = `sub-${randomUUID()}`;
    const gymA = await gym();
    const gymB = await gym();
    await person(gymA, ["member"], { subject: `sub-${randomUUID()}` });
    const userInB = await person(gymB, ["owner"], { subject });

    await deps.withUnit(gymA, async (unit) => {
      expect(await unit.gyms.find(userInB)).toBeNull();
    });
    await deps.withUnit(gymB, async (unit) => {
      expect((await unit.gyms.find(userInB))?.roles).toEqual(["owner"]);
    });
  });
});
