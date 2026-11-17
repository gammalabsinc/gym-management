import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type CreateMemberContext, makeCreateMember } from "../../app/create-member";
import type { AuditLog, MemberUnit, WithTenantTx } from "../../app/ports";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { makeWithTenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { randomCodes } from "./member-codes";
import { makeWithMemberUnit } from "./members-unit";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
/** Morning of 16 November in Toronto. */
const NOW = new Date("2026-11-16T15:00:00.000Z");
const CLOCK = { now: () => NOW };

let db: TestDatabase;
let source: DataSource;
let withUnit: WithTenantTx<MemberUnit>;
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
  withUnit = makeWithMemberUnit(makeWithTenantTx(source), {
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
  ctx: CreateMemberContext;
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
  await db.admin.query(
    "INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee) VALUES ($1, 'default', 'Default', 2000, 5000)",
    [tenantId],
  );
  return { ctx: { roles: ["staff"], tenantId, userId, requestId: `req-${counter}` } };
}

const creator = (codes = randomCodes, unit = withUnit) =>
  makeCreateMember({ withUnit: unit, clock: CLOCK, codes });

const input = (email: string, extra: Record<string, unknown> = {}) => ({
  fullName: "Ada Lovelace",
  email,
  joinDate: "2026-11-10",
  ...extra,
});

async function rowsOf(table: string, tenantId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await db.admin.query(`SELECT * FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  return rows as Record<string, unknown>[];
}

/** A code generator that hands out a fixed list first, then random codes. */
function scripted(first: string[]) {
  const queue = [...first];
  let calls = 0;
  return {
    next: () => {
      calls += 1;
      return queue.shift() ?? randomCodes.next();
    },
    calls: () => calls,
  };
}

describe("creating a member on a real database", () => {
  it("writes the person, the member, the first period, the first invoice and the audit events", async () => {
    const g = await gym();
    const result = await creator()(input("Ada@Example.test", { phone: "416-555-0100" }), g.ctx);
    if (!result.ok) throw new Error(`expected a member, got ${result.error.message}`);
    const { memberId, userId, memberNo, barcode, invoices } = result.value;

    expect(await rowsOf("users", g.ctx.tenantId)).toContainEqual(
      expect.objectContaining({
        id: userId,
        email: "ada@example.test",
        name: "Ada Lovelace",
        phone: "416-555-0100",
      }),
    );
    const roles = await db.admin.query("SELECT role FROM user_roles WHERE user_id = $1", [userId]);
    expect(roles.rows).toEqual([{ role: "member" }]);
    expect(await rowsOf("members", g.ctx.tenantId)).toEqual([
      expect.objectContaining({
        id: memberId,
        user_id: userId,
        member_no: memberNo,
        barcode,
        billing_day: 10,
        referred_by: null,
      }),
    ]);
    const periods = await db.admin.query(
      "SELECT status, valid_from::text AS valid_from, valid_to, changed_by FROM membership_periods WHERE member_id = $1",
      [memberId],
    );
    expect(periods.rows).toEqual([
      { status: "active", valid_from: "2026-11-10", valid_to: null, changed_by: g.ctx.userId },
    ]);

    expect(invoices).toHaveLength(1);
    const lines = await db.admin.query(
      `SELECT l.line_type, l.amount, i.total, i.due_date::text AS due, i.period_start::text AS start
         FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
        WHERE i.member_id = $1 ORDER BY l.line_type`,
      [memberId],
    );
    expect(lines.rows).toEqual([
      { line_type: "admission", amount: 2000, total: 7000, due: "2026-11-10", start: "2026-11-10" },
      {
        line_type: "membership",
        amount: 5000,
        total: 7000,
        due: "2026-11-10",
        start: "2026-11-10",
      },
    ]);
    const audits = await db.admin.query(
      "SELECT action, actor_user_id, entity_id, request_id FROM audit_events WHERE tenant_id = $1 ORDER BY action",
      [g.ctx.tenantId],
    );
    expect(audits.rows).toEqual([
      {
        action: "invoice.generated",
        actor_user_id: g.ctx.userId,
        entity_id: invoices[0]?.id,
        request_id: g.ctx.requestId,
      },
      {
        action: "member.created",
        actor_user_id: g.ctx.userId,
        entity_id: memberId,
        request_id: g.ctx.requestId,
      },
    ]);
  });

  it("builds the invoices of every cycle since an older join date, the admission fee on the first only", async () => {
    const g = await gym();
    const result = await creator()(input("old@example.test", { joinDate: "2026-09-16" }), g.ctx);
    expect(result.ok && result.value.invoices.map((invoice) => invoice.total)).toEqual([
      7000, 5000, 5000,
    ]);
  });

  it("returns an already a member here conflict for the same email, in any case", async () => {
    const g = await gym();
    expect((await creator()(input("dup@example.test"), g.ctx)).ok).toBe(true);
    const again = await creator()(input("DUP@Example.test"), g.ctx);
    expect(again).toMatchObject({
      ok: false,
      error: { kind: "conflict", message: "This person is already a member here" },
    });
    expect(await rowsOf("members", g.ctx.tenantId)).toHaveLength(1);
  });

  it("lets two requests for one email race, and exactly one member comes out", async () => {
    const g = await gym();
    const results = await Promise.all([
      creator()(input("race@example.test"), g.ctx),
      creator()(input("race@example.test"), g.ctx),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await rowsOf("members", g.ctx.tenantId)).toHaveLength(1);
  });

  it("makes a staff person a member without a second user row", async () => {
    const g = await gym();
    const staffEmail = `staff-${counter}@example.test`;
    const result = await creator()(input(staffEmail), g.ctx);
    expect(result).toMatchObject({ ok: true, value: { userId: g.ctx.userId } });
    expect(await rowsOf("users", g.ctx.tenantId)).toHaveLength(1);
  });

  it("allows the same email in another gym", async () => {
    const a = await gym();
    const b = await gym();
    expect((await creator()(input("both@example.test"), a.ctx)).ok).toBe(true);
    expect((await creator()(input("both@example.test"), b.ctx)).ok).toBe(true);
  });

  it("retries with new codes when the database refuses a taken one, even one held by another gym", async () => {
    const a = await gym();
    const b = await gym();
    const first = await creator()(input("first@example.test"), a.ctx);
    if (!first.ok) throw new Error("setup failed");
    // Attempt one takes member_no then barcode, so it collides on the member number. Attempt two
    // collides on the barcode. The third pair is random and free.
    const codes = scripted([first.value.memberNo, "AAAAAA", "BBBBBB", first.value.barcode]);
    const second = await creator(codes)(input("second@example.test"), b.ctx);
    expect(second.ok).toBe(true);
    expect(second.ok && second.value.memberNo).not.toBe(first.value.memberNo);
    expect(second.ok && second.value.barcode).not.toBe(first.value.barcode);
    expect(codes.calls()).toBe(6);
    expect(await rowsOf("members", a.ctx.tenantId)).toHaveLength(1);
  });

  it("gives up after a bounded number of tries and leaves nothing behind", async () => {
    const a = await gym();
    const b = await gym();
    const first = await creator()(input("taken@example.test"), a.ctx);
    if (!first.ok) throw new Error("setup failed");
    const stuck = { next: () => first.value.memberNo };
    await expect(creator(stuck)(input("stuck@example.test"), b.ctx)).rejects.toThrow(
      "No free member code",
    );
    expect(await rowsOf("users", b.ctx.tenantId)).toHaveLength(1);
    expect(await rowsOf("members", b.ctx.tenantId)).toHaveLength(0);
  });

  it("commits nothing when the audit event fails: no person, member, period or invoice", async () => {
    const g = await gym();
    const failing: WithTenantTx<MemberUnit> = (tenantId, fn) =>
      withUnit(tenantId, (unit) => {
        const audit: AuditLog = {
          record: async (event) => {
            if (event.action === "member.created") throw new Error("audit down");
            await unit.audit.record(event);
          },
        };
        return fn({ ...unit, audit });
      });
    await expect(
      creator(randomCodes, failing)(input("atomic@example.test"), g.ctx),
    ).rejects.toThrow("audit down");
    for (const table of [
      "members",
      "membership_periods",
      "invoices",
      "invoice_lines",
      "audit_events",
    ]) {
      expect(await rowsOf(table, g.ctx.tenantId)).toHaveLength(0);
    }
    expect(await rowsOf("users", g.ctx.tenantId)).toHaveLength(1);
  });

  it("stores the referrer, and refuses a referrer from another gym as not a member here", async () => {
    const a = await gym();
    const b = await gym();
    const referrer = await creator()(input("referrer@example.test"), a.ctx);
    const outsider = await creator()(input("outsider@example.test"), b.ctx);
    if (!referrer.ok || !outsider.ok) throw new Error("setup failed");

    const referred = await creator()(
      input("referred@example.test", { referredBy: referrer.value.memberId }),
      a.ctx,
    );
    expect(referred.ok).toBe(true);
    const row = (await rowsOf("members", a.ctx.tenantId)).find(
      (member) => member.id === (referred.ok && referred.value.memberId),
    );
    expect(row).toMatchObject({ referred_by: referrer.value.memberId });

    const crossGym = await creator()(
      input("cross@example.test", { referredBy: outsider.value.memberId }),
      a.ctx,
    );
    expect(crossGym).toMatchObject({
      ok: false,
      error: { kind: "validation", issues: [{ path: ["referredBy"] }] },
    });
    expect(await rowsOf("members", a.ctx.tenantId)).toHaveLength(2);
  });

  it("is conflict when the gym has no active plan, and writes nothing", async () => {
    const g = await gym();
    await db.admin.query("UPDATE plans SET is_active = false WHERE tenant_id = $1", [
      g.ctx.tenantId,
    ]);
    expect(await creator()(input("noplan@example.test"), g.ctx)).toMatchObject({
      ok: false,
      error: { kind: "conflict" },
    });
    expect(await rowsOf("users", g.ctx.tenantId)).toHaveLength(1);
  });

  it("never lets one gym see the members, periods or invoices of another", async () => {
    const a = await gym();
    const b = await gym();
    await creator()(input("a-member@example.test"), a.ctx);
    const seenByB = await makeWithTenantTx(source)(b.ctx.tenantId, async (tx) => {
      const run = (sql: string) =>
        (tx as unknown as { manager: { query(sql: string): Promise<unknown[]> } }).manager.query(
          sql,
        );
      return {
        members: await run("SELECT id FROM members"),
        periods: await run("SELECT id FROM membership_periods"),
        invoices: await run("SELECT id FROM invoices"),
      };
    });
    expect(seenByB).toEqual({ members: [], periods: [], invoices: [] });
  });
});
