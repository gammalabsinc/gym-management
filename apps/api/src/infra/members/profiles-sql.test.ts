import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type EditMemberContext, makeEditMember } from "../../app/edit-member";
import type { ProfileUnit, WithTenantTx } from "../../app/ports";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { makeWithTenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { makeWithProfileUnit } from "./profiles-unit";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
const CLOCK = { now: () => new Date("2026-11-16T15:00:00.000Z") };

let db: TestDatabase;
let source: DataSource;
let withUnit: WithTenantTx<ProfileUnit>;
let counter = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  source = new DataSource({
    ...dataSourceOptions(db.urlFor(APP_ROLE, PASSWORDS.appPassword)),
    extra: { max: 6 },
  });
  await source.initialize();
  withUnit = makeWithProfileUnit(makeWithTenantTx(source), {
    clock: CLOCK,
    ids: { next: randomUUID },
  });
});

afterAll(async () => {
  await source.destroy();
  await db.drop();
});

async function one(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await db.admin.query(sql, params);
  return (rows[0] as { id: string }).id;
}

interface Gym {
  ctx: EditMemberContext;
  memberId: string;
  memberUserId: string;
}

async function gym(): Promise<Gym> {
  counter += 1;
  const tenantId = await one(
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $1, 'America/Toronto', 'CAD') RETURNING id",
    [`gym-${counter}`],
  );
  const userId = await one("INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id", [
    tenantId,
    `staff-${counter}@example.test`,
  ]);
  const memberUserId = await one(
    "INSERT INTO users (tenant_id, email, name, phone) VALUES ($1, $2, 'Ada', '416-555-0100') RETURNING id",
    [tenantId, `member-${counter}@example.test`],
  );
  const memberId = await one(
    "INSERT INTO members (tenant_id, user_id, member_no, barcode, billing_day) VALUES ($1, $2, $3, $4, 1) RETURNING id",
    [
      tenantId,
      memberUserId,
      `N${String(counter).padStart(5, "0")}`,
      `C${String(counter).padStart(5, "0")}`,
    ],
  );
  return {
    ctx: { roles: ["staff"], tenantId, userId, requestId: `req-${counter}` },
    memberId,
    memberUserId,
  };
}

const editor = () => makeEditMember({ withUnit });

async function userRow(g: Gym) {
  const { rows } = await db.admin.query(
    "SELECT name, phone, email FROM users WHERE tenant_id = $1 AND id = $2",
    [g.ctx.tenantId, g.memberUserId],
  );
  return rows[0] as { name: string | null; phone: string | null; email: string };
}

describe("editing a member on a real database", () => {
  it("changes the name and keeps the phone and email", async () => {
    const g = await gym();
    const result = await editor()(
      { memberId: g.memberId, fields: { name: "Ada Lovelace" } },
      g.ctx,
    );
    expect(result.ok && result.value.changed).toBe(true);
    expect(await userRow(g)).toEqual({
      name: "Ada Lovelace",
      phone: "416-555-0100",
      email: `member-${counter}@example.test`,
    });
    const audit = await db.admin.query(
      "SELECT action, before, after FROM audit_events WHERE tenant_id = $1",
      [g.ctx.tenantId],
    );
    expect(audit.rows).toEqual([
      { action: "member.updated", before: { name: "Ada" }, after: { name: "Ada Lovelace" } },
    ]);
  });

  it("changes and clears the phone and keeps the name", async () => {
    const g = await gym();
    await editor()({ memberId: g.memberId, fields: { phone: "647-555-0111" } }, g.ctx);
    expect((await userRow(g)).phone).toBe("647-555-0111");
    await editor()({ memberId: g.memberId, fields: { phone: null } }, g.ctx);
    expect(await userRow(g)).toMatchObject({ name: "Ada", phone: null });
  });

  it("leaves member_no and barcode alone when an edit asks to change them", async () => {
    const g = await gym();
    const result = await editor()(
      { memberId: g.memberId, fields: { name: "Eve", memberNo: "ZZZZZZ", barcode: "YYYYYY" } },
      g.ctx,
    );
    expect(!result.ok && result.error.kind).toBe("validation");
    expect((await userRow(g)).name).toBe("Ada");
    const { rows } = await db.admin.query("SELECT member_no, barcode FROM members WHERE id = $1", [
      g.memberId,
    ]);
    expect(rows).toEqual([
      {
        member_no: `N${String(counter).padStart(5, "0")}`,
        barcode: `C${String(counter).padStart(5, "0")}`,
      },
    ]);
  });

  it("writes no audit event for an edit that changes nothing", async () => {
    const g = await gym();
    const result = await editor()({ memberId: g.memberId, fields: { name: "Ada" } }, g.ctx);
    expect(result.ok && result.value.changed).toBe(false);
    const audit = await db.admin.query("SELECT 1 FROM audit_events WHERE tenant_id = $1", [
      g.ctx.tenantId,
    ]);
    expect(audit.rows).toEqual([]);
  });

  it("rolls the edit back when the audit event cannot be written", async () => {
    const g = await gym();
    const broken = makeWithProfileUnit(makeWithTenantTx(source), {
      clock: CLOCK,
      ids: { next: () => "not-a-uuid" },
    });
    await expect(
      makeEditMember({ withUnit: broken })(
        { memberId: g.memberId, fields: { name: "Eve" } },
        g.ctx,
      ),
    ).rejects.toThrow();
    expect((await userRow(g)).name).toBe("Ada");
  });

  it("never lets another gym see or change the member", async () => {
    const a = await gym();
    const b = await gym();
    const result = await editor()({ memberId: a.memberId, fields: { name: "Hostile" } }, b.ctx);
    expect(!result.ok && result.error.kind).toBe("not_found");
    expect((await userRow(a)).name).toBe("Ada");
  });
});
