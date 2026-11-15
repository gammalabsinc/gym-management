import type pg from "pg";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditEvent } from "../../app/ports";
import { makeAuditLog } from "./audit-log";
import { dataSourceOptions } from "./data-source";
import { migrateDatabase } from "./migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "./roles";
import { makeWithTenantTx, type TenantTx } from "./tenant-tx";
import { createTestDatabase, type TestDatabase } from "./test-database";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
const INSUFFICIENT_PRIVILEGE = "42501";
const FK_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const NOW = new Date("2026-11-15T12:30:00.000Z");

let db: TestDatabase;
let app: pg.Client;
let source: DataSource;

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  app = await db.connect(APP_ROLE, PASSWORDS.appPassword);
  source = new DataSource(dataSourceOptions(db.urlFor(APP_ROLE, PASSWORDS.appPassword)));
  await source.initialize();
});

afterAll(async () => {
  await source.destroy();
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

let nextId = 0;
const ids = {
  next: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`,
};
const clock = { now: () => NOW };
const ENTITY = "11111111-1111-4111-8111-111111111111";

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    actorUserId: null,
    action: "payment.recorded",
    entityType: "payment",
    entityId: ENTITY,
    before: null,
    after: { amount: 4500 },
    requestId: "req-1",
    ...overrides,
  };
}

function record(tenantId: string, audit: AuditEvent): Promise<void> {
  return makeWithTenantTx(source)(tenantId, (tx) => makeAuditLog(tx, { clock, ids }).record(audit));
}

async function rowsOf(tenantId: string) {
  const { rows } = await app.query(
    "SELECT * FROM audit_events WHERE tenant_id = $1 ORDER BY occurred_at, id",
    [tenantId],
  );
  return rows as Record<string, unknown>[];
}

describe("audit_events at the database", () => {
  it("accepts an insert and a select from the app role", async () => {
    const id = await tenant("db-insert");
    await app.query(
      `INSERT INTO audit_events (tenant_id, id, occurred_at, action, entity_type, entity_id, request_id)
       VALUES ($1, gen_random_uuid(), now(), 'member.updated', 'member', gen_random_uuid(), 'req-db')`,
      [id],
    );
    expect(await rowsOf(id)).toHaveLength(1);
  });

  it("refuses UPDATE, DELETE and TRUNCATE from the app role", async () => {
    const id = await tenant("db-append-only");
    await record(id, event());
    const attempts = [
      app.query("UPDATE audit_events SET action = 'tampered' WHERE tenant_id = $1", [id]),
      app.query("DELETE FROM audit_events WHERE tenant_id = $1", [id]),
      app.query("TRUNCATE audit_events"),
    ];
    for (const attempt of attempts) {
      expect(await codeOf(attempt)).toBe(INSUFFICIENT_PRIVILEGE);
    }
    expect((await rowsOf(id))[0]?.action).toBe("payment.recorded");
  });

  it("keeps the grants to select and insert only", async () => {
    const { rows } = await db.admin.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE table_name = 'audit_events' AND grantee = $1 ORDER BY privilege_type`,
      [APP_ROLE],
    );
    expect(rows).toEqual([{ privilege_type: "INSERT" }, { privilege_type: "SELECT" }]);
  });

  it("requires a tenant, a non empty action, entity type and request id", async () => {
    const id = await tenant("db-checks");
    const insert = (tenantId: string, action: string, entityType: string, requestId: string) =>
      app.query(
        `INSERT INTO audit_events (tenant_id, id, occurred_at, action, entity_type, entity_id, request_id)
         VALUES ($1, gen_random_uuid(), now(), $2, $3, gen_random_uuid(), $4)`,
        [tenantId, action, entityType, requestId],
      );
    expect(await codeOf(insert(id, "", "member", "r"))).toBe(CHECK_VIOLATION);
    expect(await codeOf(insert(id, "a", "", "r"))).toBe(CHECK_VIOLATION);
    expect(await codeOf(insert(id, "a", "member", ""))).toBe(CHECK_VIOLATION);
    expect(await codeOf(insert("00000000-0000-0000-0000-000000000000", "a", "member", "r"))).toBe(
      FK_VIOLATION,
    );
  });
});

describe("makeAuditLog", () => {
  it("writes the event for the transaction's tenant with the injected time and id", async () => {
    const id = await tenant("log-write");
    const actor = await user(id, "owner@example.test");
    await record(
      id,
      event({
        actorUserId: actor,
        action: "payment.voided",
        before: { is_void: false },
        after: { is_void: true },
      }),
    );
    const [row] = await rowsOf(id);
    expect(row).toMatchObject({
      tenant_id: id,
      occurred_at: NOW,
      actor_user_id: actor,
      action: "payment.voided",
      entity_type: "payment",
      entity_id: ENTITY,
      before: { is_void: false },
      after: { is_void: true },
      request_id: "req-1",
    });
    expect(row?.id).toMatch(/^00000000-0000-4000-8000-/);
  });

  it("stores a missing snapshot and a system actor as SQL null, not JSON null", async () => {
    const id = await tenant("log-nulls");
    await record(id, event({ before: null, after: null }));
    const { rows } = await app.query(
      "SELECT before IS NULL AS no_before, after IS NULL AS no_after, actor_user_id IS NULL AS system FROM audit_events WHERE tenant_id = $1",
      [id],
    );
    expect(rows[0]).toEqual({ no_before: true, no_after: true, system: true });
  });

  it("leaves no audit row when the change is rolled back", async () => {
    const id = await tenant("log-rollback");
    const failure = new Error("the change failed after the audit call");
    await expect(
      makeWithTenantTx(source)(id, async (tx) => {
        await makeAuditLog(tx, { clock, ids }).record(event());
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await rowsOf(id)).toEqual([]);
  });

  it("commits the audit row together with the change", async () => {
    const id = await tenant("log-commit");
    await makeWithTenantTx(source)(id, async (tx) => {
      const audit = makeAuditLog(tx, { clock, ids });
      await audit.record(event({ action: "member.updated" }));
      await audit.record(event({ action: "member.updated", requestId: "req-2" }));
    });
    expect(await rowsOf(id)).toHaveLength(2);
  });

  it("refuses an actor from another gym", async () => {
    const mine = await tenant("log-cross-mine");
    const other = await tenant("log-cross-other");
    const outsider = await user(other, "outsider@example.test");
    expect(await codeOf(record(mine, event({ actorUserId: outsider })))).toBe(FK_VIOLATION);
    expect(await rowsOf(mine)).toEqual([]);
    expect(await rowsOf(other)).toEqual([]);
  });

  it("keeps each gym's events under its own tenant", async () => {
    const a = await tenant("log-iso-a");
    const b = await tenant("log-iso-b");
    await record(a, event({ requestId: "req-a" }));
    await record(b, event({ requestId: "req-b" }));
    expect((await rowsOf(a)).map((row) => row.request_id)).toEqual(["req-a"]);
    expect((await rowsOf(b)).map((row) => row.request_id)).toEqual(["req-b"]);
  });

  it("throws on an invalid event and writes nothing", async () => {
    const id = await tenant("log-invalid");
    const bad: Partial<AuditEvent>[] = [
      { action: "   " },
      { entityType: "" },
      { entityId: "not-a-uuid" },
      { actorUserId: "not-a-uuid" },
      { requestId: "x".repeat(201) },
      { after: [] as unknown as Record<string, unknown> },
    ];
    for (const overrides of bad) {
      await expect(record(id, event(overrides))).rejects.toThrow();
    }
    await expect(record(id, { ...event(), extra: 1 } as unknown as AuditEvent)).rejects.toThrow();
    expect(await rowsOf(id)).toEqual([]);
  });

  it("refuses a forged handle, and a handle whose transaction has ended", async () => {
    const forged = { tenantId: "t", manager: source.manager } as unknown as TenantTx;
    expect(() => makeAuditLog(forged, { clock, ids })).toThrow("only be built inside withTenantTx");
    const id = await tenant("log-ended");
    const kept = await makeWithTenantTx(source)(id, async (tx) => tx);
    expect(() => makeAuditLog(kept, { clock, ids })).toThrow("only be built inside withTenantTx");
  });
});
