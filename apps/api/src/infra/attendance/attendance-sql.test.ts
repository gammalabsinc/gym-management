import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makePauseMember } from "../../app/change-membership";
import { makeCreateMember } from "../../app/create-member";
import type {
  MembershipUnit,
  MemberUnit,
  PaymentUnit,
  ScanUnit,
  WithTenantTx,
} from "../../app/ports";
import { makeRecordPayment } from "../../app/record-payment";
import { makeRecordScan, type RecordScanContext } from "../../app/record-scan";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { makeWithTenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { makeTxExecutor } from "../db/tx-executor";
import { randomCodes } from "../members/member-codes";
import { makeWithMemberUnit } from "../members/members-unit";
import { makeWithMembershipUnit } from "../memberships/memberships-unit";
import { makeWithPaymentUnit } from "../payments/payments-unit";
import { makeWithScanUnit } from "./attendance-unit";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
/** Morning of 16 November in Toronto. */
const NOW = new Date("2026-11-16T15:00:00.000Z");
const CLOCK = { now: () => NOW };

let db: TestDatabase;
let source: DataSource;
let withTenantTx: ReturnType<typeof makeWithTenantTx>;
let withMember: WithTenantTx<MemberUnit>;
let withMembership: WithTenantTx<MembershipUnit>;
let withScan: WithTenantTx<ScanUnit>;
let withPayment: WithTenantTx<PaymentUnit>;
let counter = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  source = new DataSource({
    ...dataSourceOptions(db.urlFor(APP_ROLE, PASSWORDS.appPassword)),
    extra: { max: 8 },
  });
  await source.initialize();
  withTenantTx = makeWithTenantTx(source);
  const audit = { clock: CLOCK, ids: { next: randomUUID } };
  withMember = makeWithMemberUnit(withTenantTx, audit);
  withMembership = makeWithMembershipUnit(withTenantTx, audit);
  withScan = makeWithScanUnit(withTenantTx);
  withPayment = makeWithPaymentUnit(withTenantTx, audit);
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
  readonly ctx: RecordScanContext;
  readonly staff: {
    readonly roles: readonly ["staff"];
    readonly tenantId: string;
    readonly userId: string;
    readonly requestId: string;
  };
}

/** A gym in Toronto with one staff user and the default plan. */
async function gym(): Promise<Gym> {
  counter += 1;
  const tenantId = await one(
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $1, 'America/Toronto', 'CAD') RETURNING id",
    [`scan-gym-${counter}`],
  );
  const userId = await one("INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id", [
    tenantId,
    `staff-${counter}@example.test`,
  ]);
  await db.admin.query(
    "INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee) VALUES ($1, 'default', 'Default', 2000, 5000)",
    [tenantId],
  );
  return {
    ctx: { roles: ["staff"], tenantId },
    staff: { roles: ["staff"], tenantId, userId, requestId: `req-${counter}` },
  };
}

interface Member {
  readonly memberId: string;
  readonly barcode: string;
}

async function member(g: Gym, joinDate = "2026-11-10"): Promise<Member> {
  counter += 1;
  const created = await makeCreateMember({
    withUnit: withMember,
    clock: CLOCK,
    codes: randomCodes,
  })({ fullName: "Ada Lovelace", email: `ada-${counter}@example.test`, joinDate }, g.staff);
  if (!created.ok) throw new Error(`expected a member, got ${created.error.message}`);
  return { memberId: created.value.memberId, barcode: created.value.barcode };
}

/** Pays the member's first invoice in full: the 2000 admission fee and the 5000 monthly fee. */
async function payFirstInvoice(g: Gym, memberId: string): Promise<void> {
  const paid = await makeRecordPayment({ withUnit: (t, fn) => withPayment(t, fn), clock: CLOCK })(
    { clientRequestId: randomUUID(), memberId, amount: 7000, method: "cash" },
    g.staff,
  );
  if (!paid.ok) throw new Error(`expected a payment, got ${paid.error.message}`);
}

function scanner(now: Date = NOW) {
  return makeRecordScan({ withUnit: (t, fn) => withScan(t, fn), clock: { now: () => now } });
}

const scan = scanner();

async function attendanceOf(memberId: string) {
  const { rows } = await db.admin.query(
    `SELECT is_duplicate, status_at_scan, source, to_char(local_date, 'YYYY-MM-DD') AS local_date
       FROM attendance WHERE member_id = $1 ORDER BY created_at, id`,
    [memberId],
  );
  return rows as {
    is_duplicate: boolean;
    status_at_scan: string;
    source: string;
    local_date: string;
  }[];
}

async function attendanceCount(): Promise<number> {
  const { rows } = await db.admin.query("SELECT count(*)::int AS n FROM attendance");
  return (rows[0] as { n: number }).n;
}

describe("recording a scan against Postgres", () => {
  it("stores the scan with the gym's local date and the standing at scan time", async () => {
    const g = await gym();
    const m = await member(g);
    await payFirstInvoice(g, m.memberId);
    const result = await scan({ barcode: m.barcode }, g.ctx);
    expect(result.ok && result.value.found).toBe(true);
    if (!result.ok || !result.value.found) return;
    expect(result.value.member).toMatchObject({
      id: m.memberId,
      name: "Ada Lovelace",
      standing: "paid",
      status: "active",
      statusChangedOn: null,
    });
    expect(result.value.member.paidThrough).not.toBeNull();
    expect(result.value.visit).toMatchObject({ memberId: m.memberId, isDuplicate: false });
    expect(await attendanceOf(m.memberId)).toEqual([
      {
        is_duplicate: false,
        status_at_scan: "paid",
        source: "staff_app",
        local_date: "2026-11-16",
      },
    ]);
  });

  it("leaves paid through empty for a new member who has not paid", async () => {
    const g = await gym();
    const m = await member(g, "2026-11-16");
    const result = await scan({ barcode: m.barcode }, g.ctx);
    expect(result.ok && result.value.found && result.value.member).toMatchObject({
      standing: "due_soon",
      paidThrough: null,
    });
  });

  it("stores the local day, not the UTC day, for a scan late in the evening", async () => {
    const g = await gym();
    const m = await member(g);
    const late = new Date("2026-11-17T03:30:00.000Z");
    await scanner(late)({ barcode: m.barcode }, g.ctx);
    expect((await attendanceOf(m.memberId))[0]?.local_date).toBe("2026-11-16");
  });

  it("marks a second scan inside the window as a duplicate and reports the first check in", async () => {
    const g = await gym();
    const m = await member(g);
    await scan({ barcode: m.barcode }, g.ctx);
    const again = await scanner(new Date(NOW.getTime() + 5 * 60_000))(
      { barcode: m.barcode },
      g.ctx,
    );
    expect(again.ok && again.value.found && again.value.visit.isDuplicate).toBe(true);
    expect(again.ok && again.value.found && again.value.firstCheckInAt).toBe(
      "2026-11-16T15:00:00.000000Z",
    );
    expect((await attendanceOf(m.memberId)).map((r) => r.is_duplicate)).toEqual([false, true]);
  });

  it("counts a scan after the window as a new check in", async () => {
    const g = await gym();
    const m = await member(g);
    await scan({ barcode: m.barcode }, g.ctx);
    const later = await scanner(new Date(NOW.getTime() + 11 * 60_000))(
      { barcode: m.barcode },
      g.ctx,
    );
    expect(later.ok && later.value.found && later.value.visit.isDuplicate).toBe(false);
    expect(later.ok && later.value.found && later.value.firstCheckInAt).toBeNull();
  });

  it("keeps the window anchored on the original scan, so repeats do not extend it", async () => {
    const g = await gym();
    const m = await member(g);
    await scan({ barcode: m.barcode }, g.ctx);
    await scanner(new Date(NOW.getTime() + 8 * 60_000))({ barcode: m.barcode }, g.ctx);
    const third = await scanner(new Date(NOW.getTime() + 12 * 60_000))(
      { barcode: m.barcode },
      g.ctx,
    );
    expect(third.ok && third.value.found && third.value.visit.isDuplicate).toBe(false);
  });

  it("stores two scans in the same instant and exactly one is the original", async () => {
    const g = await gym();
    const m = await member(g);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => scan({ barcode: m.barcode }, g.ctx)),
    );
    expect(results.every((r) => r.ok && r.value.found)).toBe(true);
    const rows = await attendanceOf(m.memberId);
    expect(rows).toHaveLength(6);
    expect(rows.filter((r) => !r.is_duplicate)).toHaveLength(1);
  });

  it("never rejects a scan for an overdue member and snapshots the standing", async () => {
    const g = await gym();
    const m = await member(g, "2026-09-01");
    const result = await scan({ barcode: m.barcode }, g.ctx);
    expect(result.ok && result.value.found && result.value.member.standing).toBe("overdue");
    expect((await attendanceOf(m.memberId))[0]?.status_at_scan).toBe("overdue");
  });

  it("stores a scan for a paused member as inactive and reports when the pause began", async () => {
    const g = await gym();
    const m = await member(g);
    const paused = await makePauseMember({ withUnit: withMembership, clock: CLOCK })(
      { memberId: m.memberId, reason: "away" },
      { ...g.staff, roles: ["owner"] },
    );
    expect(paused.ok).toBe(true);
    const result = await scan({ barcode: m.barcode, source: "manual" }, g.ctx);
    expect(result.ok && result.value.found && result.value.member).toMatchObject({
      standing: "inactive",
      status: "paused",
      statusChangedOn: "2026-11-16",
    });
    expect((await attendanceOf(m.memberId))[0]).toMatchObject({
      status_at_scan: "inactive",
      source: "manual",
    });
  });

  it("answers a barcode of another gym exactly like a random string, and writes nothing", async () => {
    const g = await gym();
    const other = await gym();
    const theirs = await member(other);
    const before = await attendanceCount();
    const foreign = await scan({ barcode: theirs.barcode }, g.ctx);
    const random = await scan({ barcode: "no-such-code" }, g.ctx);
    expect(foreign).toEqual({ ok: true, value: { found: false } });
    expect(random).toEqual(foreign);
    expect(await attendanceCount()).toBe(before);
  });

  it("does not let another gym read the attendance rows", async () => {
    const g = await gym();
    const other = await gym();
    const m = await member(g);
    await scan({ barcode: m.barcode }, g.ctx);
    const seen = await withTenantTx(other.ctx.tenantId, (tx) =>
      makeTxExecutor(tx).query("SELECT member_id FROM attendance", []),
    );
    expect(seen).toEqual([]);
    const own = await withTenantTx(g.ctx.tenantId, (tx) =>
      makeTxExecutor(tx).query("SELECT member_id FROM attendance", []),
    );
    expect(own).toEqual([{ member_id: m.memberId }]);
  });

  it("writes no audit event for a scan", async () => {
    const g = await gym();
    const m = await member(g);
    const { rows: before } = await db.admin.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1",
      [g.ctx.tenantId],
    );
    await scan({ barcode: m.barcode }, g.ctx);
    const { rows: after } = await db.admin.query(
      "SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1",
      [g.ctx.tenantId],
    );
    expect(after).toEqual(before);
  });
});
