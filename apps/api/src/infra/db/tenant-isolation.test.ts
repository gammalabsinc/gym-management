import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataSourceOptions } from "./data-source";
import { migrateDatabase } from "./migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "./roles";
import { makeWithTenantTx } from "./tenant-tx";
import { createTestDatabase, type TestDatabase } from "./test-database";

/**
 * Two gyms, every tenant table, attempted from the other side through the same path the API uses.
 * The tables are found in the catalog, and a table without a seeded row for each gym fails the
 * suite, so a new tenant table cannot slip in without being attacked here.
 */

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
const INSUFFICIENT_PRIVILEGE = "42501";

interface Gym {
  readonly tenantId: string;
  readonly userId: string;
  readonly barcode: string;
}

let db: TestDatabase;
let source: DataSource;
let gymA: Gym;
let gymB: Gym;
let tables: string[];

async function seedGym(name: string, number: number): Promise<Gym> {
  const tenant = await db.admin.query(
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $1, 'UTC', 'CAD') RETURNING id",
    [name],
  );
  const tenantId = (tenant.rows[0] as { id: string }).id;
  const user = await db.admin.query(
    "INSERT INTO users (tenant_id, email, auth_subject) VALUES ($1, $2, $3) RETURNING id",
    [tenantId, `owner@${name}.test`, `google-${name}`],
  );
  const userId = (user.rows[0] as { id: string }).id;
  await db.admin.query(
    "INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, 'owner')",
    [tenantId, userId],
  );
  await db.admin.query(
    `INSERT INTO audit_events (tenant_id, id, occurred_at, actor_user_id, action, entity_type, entity_id, request_id)
     VALUES ($1, gen_random_uuid(), now(), $2, 'member.updated', 'member', gen_random_uuid(), 'seed')`,
    [tenantId, userId],
  );
  const barcode = `BAR-${name}`;
  await seedBusinessRows(tenantId, userId, number, barcode);
  return { tenantId, userId, barcode };
}

/** One row in every business table, linked the way the application links them. */
async function seedBusinessRows(
  tenantId: string,
  userId: string,
  number: number,
  barcode: string,
): Promise<void> {
  const one = async (sql: string, params: unknown[]): Promise<string> => {
    const { rows } = await db.admin.query(sql, params);
    return (rows[0] as { id: string }).id;
  };
  const plan = await one(
    "INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee) VALUES ($1, 'basic', 'Basic', 1000, 4500) RETURNING id",
    [tenantId],
  );
  const member = await one(
    "INSERT INTO members (tenant_id, user_id, member_no, barcode, billing_day) VALUES ($1, $2, $3, $4, 1) RETURNING id",
    [tenantId, userId, `MEM00${number}`, barcode],
  );
  await db.admin.query(
    "INSERT INTO membership_periods (tenant_id, member_id, plan_id, status, valid_from) VALUES ($1, $2, $3, 'active', '2026-01-01')",
    [tenantId, member, plan],
  );
  const invoice = await one(
    `INSERT INTO invoices (tenant_id, member_id, period_start, period_end, due_date, total)
     VALUES ($1, $2, '2026-01-01', '2026-01-31', '2026-01-01', 4500) RETURNING id`,
    [tenantId, member],
  );
  const payment = await one(
    `INSERT INTO payments (tenant_id, member_id, amount, method, paid_on, recorded_by, client_request_id)
     VALUES ($1, $2, 4500, 'cash', '2026-01-02', $3, gen_random_uuid()) RETURNING id`,
    [tenantId, member, userId],
  );
  await db.admin.query(
    "INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, amount) VALUES ($1, $2, $3, 4500)",
    [tenantId, payment, invoice],
  );
  await db.admin.query(
    `INSERT INTO member_discounts (tenant_id, member_id, kind, amount, is_recurring, reason, starts_on)
     VALUES ($1, $2, 'manual', 500, false, 'goodwill', '2026-01-01')`,
    [tenantId, member],
  );
  await db.admin.query(
    "INSERT INTO invoice_lines (tenant_id, invoice_id, line_type, description, amount) VALUES ($1, $2, 'membership', 'Monthly fee', 4500)",
    [tenantId, invoice],
  );
  await db.admin.query(
    `INSERT INTO attendance (tenant_id, member_id, scanned_at, local_date, is_duplicate, status_at_scan, source)
     VALUES ($1, $2, now(), current_date, false, 'paid', 'staff_app')`,
    [tenantId, member],
  );
}

async function countFor(table: string, tenantId: string): Promise<number> {
  const { rows } = await db.admin.query(
    `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
    [tenantId],
  );
  return (rows[0] as { n: number }).n;
}

/** Runs a statement as the app role, inside a transaction for one gym. */
function asGym<T>(gym: Gym, sql: string, params: unknown[] = []): Promise<T> {
  return makeWithTenantTx(source)(
    gym.tenantId,
    (tx) => tx.manager.query(sql, params) as Promise<T>,
  );
}

async function countsFor(tenantId: string): Promise<number[]> {
  const counts: number[] = [];
  for (const table of tables) counts.push(await countFor(table, tenantId));
  return counts;
}

async function errorCode(attempt: Promise<unknown>): Promise<string | undefined> {
  try {
    await attempt;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  source = new DataSource(dataSourceOptions(db.urlFor(APP_ROLE, PASSWORDS.appPassword)));
  await source.initialize();
  gymA = await seedGym("gym-a", 1);
  gymB = await seedGym("gym-b", 2);
  const { rows } = await db.admin.query(
    `SELECT DISTINCT c.relname AS name FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE a.attname = 'tenant_id' AND NOT a.attisdropped AND c.relkind IN ('r', 'p') AND n.nspname = 'public'
     ORDER BY c.relname`,
  );
  tables = (rows as { name: string }[]).map((row) => row.name);
});

afterAll(async () => {
  await source.destroy();
  await db.drop();
});

describe("tenant isolation", () => {
  it("has a seeded row in both gyms for every tenant table", async () => {
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(await countFor(table, gymA.tenantId), `${table} has no row for gym A`).toBeGreaterThan(
        0,
      );
      expect(await countFor(table, gymB.tenantId), `${table} has no row for gym B`).toBeGreaterThan(
        0,
      );
    }
  });

  it("shows each gym only its own rows in every tenant table", async () => {
    for (const table of tables) {
      for (const [gym, other] of [
        [gymA, gymB],
        [gymB, gymA],
      ] as const) {
        const seen = await asGym<{ tenant_id: string }[]>(gym, `SELECT tenant_id FROM ${table}`);
        expect(seen.length, table).toBe(await countFor(table, gym.tenantId));
        expect(
          seen.every((row) => row.tenant_id === gym.tenantId),
          table,
        ).toBe(true);
        const asked = await asGym<unknown[]>(gym, `SELECT * FROM ${table} WHERE tenant_id = $1`, [
          other.tenantId,
        ]);
        expect(asked, `${table} leaked to the other gym`).toEqual([]);
      }
    }
  });

  it("finds no row of the other gym by guessing its id", async () => {
    const { rows } = await db.admin.query("SELECT id FROM users WHERE tenant_id = $1", [
      gymB.tenantId,
    ]);
    const guessed = (rows[0] as { id: string }).id;
    expect(await asGym(gymA, "SELECT 1 FROM users WHERE id = $1", [guessed])).toEqual([]);
    expect(await asGym(gymA, "SELECT 1 FROM user_roles WHERE user_id = $1", [guessed])).toEqual([]);
    expect(
      await asGym(gymA, "SELECT 1 FROM audit_events WHERE actor_user_id = $1", [guessed]),
    ).toEqual([]);
  });

  it("finds no member of the other gym by its barcode", async () => {
    expect(await asGym(gymA, "SELECT 1 FROM members WHERE barcode = $1", [gymB.barcode])).toEqual(
      [],
    );
    expect(await asGym(gymB, "SELECT 1 FROM members WHERE barcode = $1", [gymA.barcode])).toEqual(
      [],
    );
    const own = await asGym<unknown[]>(gymA, "SELECT 1 FROM members WHERE barcode = $1", [
      gymA.barcode,
    ]);
    expect(own).toHaveLength(1);
  });

  it("changes and removes nothing of the other gym, and leaves its rows intact", async () => {
    const before = await countsFor(gymB.tenantId);
    for (const table of tables) {
      const touched = await errorCode(
        asGym(gymA, `UPDATE ${table} SET tenant_id = $1 WHERE tenant_id = $2`, [
          gymA.tenantId,
          gymB.tenantId,
        ]),
      );
      // Append only tables refuse the statement outright. Others match no row.
      expect([undefined, INSUFFICIENT_PRIVILEGE], table).toContain(touched);
      const removed = await errorCode(
        asGym(gymA, `DELETE FROM ${table} WHERE tenant_id = $1`, [gymB.tenantId]),
      );
      expect([undefined, INSUFFICIENT_PRIVILEGE], table).toContain(removed);
    }
    const after = await countsFor(gymB.tenantId);
    expect(after).toEqual(before);
    const owner = await db.admin.query("SELECT tenant_id FROM users WHERE id = $1", [gymB.userId]);
    expect(owner.rows).toEqual([{ tenant_id: gymB.tenantId }]);
  });

  it("refuses to plant a row in the other gym", async () => {
    const plants = [
      () =>
        asGym(gymA, "INSERT INTO users (tenant_id, email) VALUES ($1, 'planted@example.com')", [
          gymB.tenantId,
        ]),
      () =>
        asGym(gymA, "INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, 'staff')", [
          gymB.tenantId,
          gymB.userId,
        ]),
      () =>
        asGym(
          gymA,
          `INSERT INTO audit_events (tenant_id, id, occurred_at, action, entity_type, entity_id, request_id)
         VALUES ($1, gen_random_uuid(), now(), 'forged', 'member', gen_random_uuid(), 'forged')`,
          [gymB.tenantId],
        ),
    ];
    plants.push(
      () =>
        asGym(
          gymA,
          "INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee) VALUES ($1, 'planted', 'Planted', 0, 0)",
          [gymB.tenantId],
        ),
      () =>
        asGym(
          gymA,
          `INSERT INTO attendance (tenant_id, member_id, scanned_at, local_date, is_duplicate, status_at_scan, source)
           SELECT $1, id, now(), current_date, false, 'paid', 'manual' FROM members LIMIT 1`,
          [gymB.tenantId],
        ),
    );
    for (const plant of plants) {
      expect(await errorCode(plant())).toBe(INSUFFICIENT_PRIVILEGE);
    }
  });

  it("gives a gym nothing when the tenant is one that does not exist", async () => {
    const stranger: Gym = { ...gymA, tenantId: "00000000-0000-4000-8000-000000000000" };
    for (const table of tables) {
      expect(await asGym(stranger, `SELECT 1 FROM ${table}`), table).toEqual([]);
    }
  });
});
