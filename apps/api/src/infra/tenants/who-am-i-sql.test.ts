import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { makeWithTenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { makeWhoAmIStore } from "./who-am-i-sql";
import { makeWithWhoAmIUnit } from "./who-am-i-unit";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };

let db: TestDatabase;
let source: DataSource;
let counter = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  source = new DataSource(dataSourceOptions(db.urlFor(APP_ROLE, PASSWORDS.appPassword)));
  await source.initialize();
});

afterAll(async () => {
  await source.destroy();
  await db.drop();
});

async function one(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await db.admin.query(sql, params);
  return (rows[0] as { id: string }).id;
}

async function gym(): Promise<string> {
  counter += 1;
  return one(
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $1, 'America/Toronto', 'CAD') RETURNING id",
    [`gym-${counter}`],
  );
}

async function person(
  tenantId: string,
  roles: string[],
  options: { name?: string; isActive?: boolean } = {},
): Promise<string> {
  counter += 1;
  const userId = await one(
    "INSERT INTO users (tenant_id, email, name, is_active) VALUES ($1, $2, $3, $4) RETURNING id",
    [tenantId, `p${counter}@example.test`, options.name ?? null, options.isActive ?? true],
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

const read = (tenantId: string, userId: string) =>
  makeWithWhoAmIUnit(makeWithTenantTx(source))(tenantId, (unit) => unit.me.find(userId));

describe("the who am i read on a real database", () => {
  it("returns the user with every role, sorted, and no member record for staff", async () => {
    const tenantId = await gym();
    const userId = await person(tenantId, ["staff", "owner"], { name: "Sam" });
    expect(await read(tenantId, userId)).toEqual({
      userId,
      name: "Sam",
      email: expect.stringMatching(/@example\.test$/),
      roles: ["owner", "staff"],
      memberId: null,
    });
  });

  it("returns the member record the user owns", async () => {
    const tenantId = await gym();
    const userId = await person(tenantId, ["member"]);
    counter += 1;
    const memberId = await one(
      `INSERT INTO members (tenant_id, user_id, member_no, barcode, billing_day)
       VALUES ($1, $2, $3, $4, 5) RETURNING id`,
      [tenantId, userId, `WHO${String(counter).padStart(3, "0")}`, `barcode-who-${counter}`],
    );
    expect((await read(tenantId, userId))?.memberId).toBe(memberId);
  });

  it("returns a user with no role as having no roles", async () => {
    const tenantId = await gym();
    const userId = await person(tenantId, []);
    expect((await read(tenantId, userId))?.roles).toEqual([]);
  });

  it("does not find a switched off user", async () => {
    const tenantId = await gym();
    const userId = await person(tenantId, ["owner"], { isActive: false });
    expect(await read(tenantId, userId)).toBeNull();
  });

  it("does not let another gym read the user: the same id in the wrong tenant finds nothing", async () => {
    const mine = await gym();
    const theirs = await gym();
    const theirUser = await person(theirs, ["owner"], { name: "Other" });
    expect(await read(mine, theirUser)).toBeNull();
    expect(await read(theirs, theirUser)).not.toBeNull();
  });

  it("builds the store directly on an executor", async () => {
    const tenantId = await gym();
    const userId = await person(tenantId, ["member"]);
    const store = makeWhoAmIStore(
      { query: async (sql, params) => (await db.admin.query(sql, params)).rows },
      tenantId,
    );
    expect((await store.find(userId))?.roles).toEqual(["member"]);
  });
});
