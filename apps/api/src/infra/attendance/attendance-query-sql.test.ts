import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AttendanceCaller,
  makeDailyVisitCounts,
  makeMemberHistory,
  makeMemberVisitCounts,
  makeTodaysAttendance,
} from "../../app/attendance-queries";
import { makeCreateMember } from "../../app/create-member";
import type { AttendanceQueryUnit, MemberUnit, ScanUnit, WithTenantTx } from "../../app/ports";
import { makeRecordScan } from "../../app/record-scan";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { makeWithTenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { randomCodes } from "../members/member-codes";
import { makeWithMemberUnit } from "../members/members-unit";
import { makeWithAttendanceQueryUnit, makeWithScanUnit } from "./attendance-unit";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
/** Half past ten in the evening on 30 November in Toronto, already 1 December in UTC. */
const NOW = new Date("2026-12-01T03:30:00.000Z");
const CLOCK = { now: () => NOW };

let db: TestDatabase;
let source: DataSource;
let withMember: WithTenantTx<MemberUnit>;
let withScan: WithTenantTx<ScanUnit>;
let withAttendance: WithTenantTx<AttendanceQueryUnit>;
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
  const withTenantTx = makeWithTenantTx(source);
  const audit = { clock: CLOCK, ids: { next: randomUUID } };
  withMember = makeWithMemberUnit(withTenantTx, audit);
  withScan = makeWithScanUnit(withTenantTx);
  withAttendance = makeWithAttendanceQueryUnit(withTenantTx);
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
  readonly staff: AttendanceCaller;
  readonly owner: AttendanceCaller;
  readonly creator: {
    readonly roles: readonly ["staff"];
    readonly tenantId: string;
    readonly userId: string;
    readonly requestId: string;
  };
}

async function gym(timezone = "America/Toronto"): Promise<Gym> {
  counter += 1;
  const tenantId = await one(
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $1, $2, 'CAD') RETURNING id",
    [`attendance-gym-${counter}`, timezone],
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
    staff: { roles: ["staff"], tenantId },
    owner: { roles: ["owner"], tenantId },
    creator: { roles: ["staff"], tenantId, userId, requestId: `req-${counter}` },
  };
}

async function member(g: Gym, fullName = "Ada Lovelace") {
  counter += 1;
  const created = await makeCreateMember({
    withUnit: withMember,
    clock: CLOCK,
    codes: randomCodes,
  })({ fullName, email: `m-${counter}@example.test`, joinDate: "2026-09-01" }, g.creator);
  if (!created.ok) throw new Error(`expected a member, got ${created.error.message}`);
  return { memberId: created.value.memberId, barcode: created.value.barcode };
}

/** Scans through the real use case at `at`, so the local day and the duplicate flag are the real ones. */
async function scanAt(g: Gym, barcode: string, at: string): Promise<void> {
  const scan = makeRecordScan({
    withUnit: (t, fn) => withScan(t, fn),
    clock: { now: () => new Date(at) },
  });
  const result = await scan({ barcode }, g.staff);
  if (!result.ok || !result.value.found) throw new Error("expected the scan to be stored");
}

const history = makeMemberHistory({ withUnit: (t, fn) => withAttendance(t, fn), clock: CLOCK });
const visitCounts = makeMemberVisitCounts({
  withUnit: (t, fn) => withAttendance(t, fn),
  clock: CLOCK,
});
const today = makeTodaysAttendance({ withUnit: (t, fn) => withAttendance(t, fn), clock: CLOCK });
const perDay = makeDailyVisitCounts({ withUnit: (t, fn) => withAttendance(t, fn), clock: CLOCK });

describe("member history against Postgres", () => {
  it("lists scans newest first with repeats marked, and pages without gaps or repeats", async () => {
    const g = await gym();
    const m = await member(g);
    await scanAt(g, m.barcode, "2026-11-20T15:00:00.000Z");
    await scanAt(g, m.barcode, "2026-11-20T15:05:00.000Z");
    await scanAt(g, m.barcode, "2026-11-22T15:00:00.000Z");

    const first = await history({ memberId: m.memberId, limit: 2 }, g.staff);
    if (!first.ok) throw new Error(first.error.message);
    expect(first.value.items.map((row) => row.scannedAt)).toEqual([
      "2026-11-22T15:00:00.000000Z",
      "2026-11-20T15:05:00.000000Z",
    ]);
    expect(first.value.items[1]).toMatchObject({
      isDuplicate: true,
      memberName: "Ada Lovelace",
      localDate: "2026-11-20",
      statusAtScan: "overdue",
      source: "staff_app",
    });
    expect(first.value.nextCursor).not.toBeNull();

    const second = await history(
      { memberId: m.memberId, limit: 2, cursor: first.value.nextCursor },
      g.staff,
    );
    if (!second.ok) throw new Error(second.error.message);
    expect(second.value.items.map((row) => row.scannedAt)).toEqual(["2026-11-20T15:00:00.000000Z"]);
    expect(second.value.nextCursor).toBeNull();
  });

  it("answers not found for a member of another gym", async () => {
    const a = await gym();
    const b = await gym();
    const m = await member(a);
    await scanAt(a, m.barcode, "2026-11-20T15:00:00.000Z");
    const result = await history({ memberId: m.memberId }, b.staff);
    expect(result).toMatchObject({ ok: false, error: { kind: "not_found" } });
  });
});

describe("the store keeps repeats out when asked", () => {
  it("leaves duplicates out of a history that does not include them", async () => {
    const g = await gym();
    const m = await member(g);
    await scanAt(g, m.barcode, "2026-11-20T15:00:00.000Z");
    await scanAt(g, m.barcode, "2026-11-20T15:05:00.000Z");
    const rows = await withAttendance(g.staff.tenantId, (unit) =>
      unit.attendance.history(m.memberId, { limit: 10, after: null }, false),
    );
    expect(rows.map((row) => row.isDuplicate)).toEqual([false]);
  });
});

describe("visit counts against Postgres", () => {
  it("uses the gym's month, so a scan at 22:30 on the last evening stays in that month", async () => {
    const g = await gym();
    const m = await member(g);
    // Local days: 31 October, 30 November (twice, the second a repeat), and 1 December in UTC only.
    await scanAt(g, m.barcode, "2026-10-31T23:30:00.000Z");
    await scanAt(g, m.barcode, "2026-11-10T15:00:00.000Z");
    await scanAt(g, m.barcode, "2026-12-01T03:30:00.000Z");
    await scanAt(g, m.barcode, "2026-12-01T03:35:00.000Z");
    const result = await visitCounts({ memberId: m.memberId }, g.staff);
    // NOW is 30 November in Toronto: this month is November, last month is October.
    expect(result).toEqual({ ok: true, value: { thisMonth: 2, lastMonth: 1 } });
  });

  it("counts nothing for a member with no scans", async () => {
    const g = await gym();
    const m = await member(g);
    expect(await visitCounts({ memberId: m.memberId }, g.staff)).toEqual({
      ok: true,
      value: { thisMonth: 0, lastMonth: 0 },
    });
  });

  it("does not count another gym's member", async () => {
    const a = await gym();
    const b = await gym();
    const m = await member(a);
    await scanAt(a, m.barcode, "2026-11-10T15:00:00.000Z");
    expect(await visitCounts({ memberId: m.memberId }, b.staff)).toMatchObject({
      ok: false,
      error: { kind: "not_found" },
    });
  });
});

describe("today's list against Postgres", () => {
  it("lists the gym's local day, repeats marked, and nothing of another gym", async () => {
    const a = await gym();
    const b = await gym();
    const ada = await member(a, "Ada Lovelace");
    const grace = await member(a, "Grace Hopper");
    const other = await member(b, "Other Gym Member");
    await scanAt(a, ada.barcode, "2026-11-30T15:00:00.000Z");
    await scanAt(a, ada.barcode, "2026-11-30T15:05:00.000Z");
    await scanAt(a, grace.barcode, "2026-12-01T03:00:00.000Z");
    await scanAt(a, grace.barcode, "2026-11-29T15:00:00.000Z");
    await scanAt(b, other.barcode, "2026-11-30T15:00:00.000Z");

    const result = await today({}, a.staff);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.items.map((row) => [row.memberName, row.isDuplicate])).toEqual([
      ["Grace Hopper", false],
      ["Ada Lovelace", true],
      ["Ada Lovelace", false],
    ]);
    const bResult = await today({}, b.staff);
    expect(bResult.ok && bResult.value.items.map((row) => row.memberName)).toEqual([
      "Other Gym Member",
    ]);
  });

  it("pages through the day", async () => {
    const g = await gym();
    const m = await member(g);
    await scanAt(g, m.barcode, "2026-11-30T12:00:00.000Z");
    await scanAt(g, m.barcode, "2026-11-30T14:00:00.000Z");
    const first = await today({ limit: 1 }, g.staff);
    if (!first.ok) throw new Error(first.error.message);
    const second = await today({ limit: 1, cursor: first.value.nextCursor }, g.staff);
    if (!second.ok) throw new Error(second.error.message);
    expect(first.value.items[0]?.scannedAt).toBe("2026-11-30T14:00:00.000000Z");
    expect(second.value.items.map((row) => row.scannedAt)).toEqual(["2026-11-30T12:00:00.000000Z"]);
    expect(second.value.nextCursor).toBeNull();
  });
});

describe("visits per day against Postgres", () => {
  it("counts originals per gym local day, fills empty days, and stays inside the gym", async () => {
    const a = await gym();
    const b = await gym();
    const ada = await member(a);
    const grace = await member(a, "Grace Hopper");
    const other = await member(b);
    await scanAt(a, ada.barcode, "2026-11-29T15:00:00.000Z");
    await scanAt(a, ada.barcode, "2026-11-29T15:05:00.000Z");
    await scanAt(a, grace.barcode, "2026-11-29T16:00:00.000Z");
    await scanAt(a, grace.barcode, "2026-12-01T03:00:00.000Z");
    await scanAt(b, other.barcode, "2026-11-29T15:00:00.000Z");

    const result = await perDay({ from: "2026-11-28", to: "2026-12-01" }, a.owner);
    expect(result).toEqual({
      ok: true,
      value: [
        { date: "2026-11-28", visits: 0 },
        { date: "2026-11-29", visits: 2 },
        { date: "2026-11-30", visits: 1 },
        { date: "2026-12-01", visits: 0 },
      ],
    });
  });
});
