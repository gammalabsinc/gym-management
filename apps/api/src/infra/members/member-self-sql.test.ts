import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCreateMember } from "../../app/create-member";
import {
  type MemberSelfCaller,
  makeGetMyAttendance,
  makeGetMyCard,
  makeGetMyProfile,
} from "../../app/member-self-service";
import type { MemberSelfServiceUnit, MemberUnit, ScanUnit, WithTenantTx } from "../../app/ports";
import { makeRecordScan } from "../../app/record-scan";
import { makeWithScanUnit } from "../attendance/attendance-unit";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { makeWithTenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { randomCodes } from "./member-codes";
import { makeWithMemberSelfUnit } from "./member-self-unit";
import { makeWithMemberUnit } from "./members-unit";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
/** Half past ten in the evening on 30 November in Toronto, already 1 December in UTC. */
const NOW = new Date("2026-12-01T03:30:00.000Z");
const CLOCK = { now: () => NOW };

let db: TestDatabase;
let source: DataSource;
let withMember: WithTenantTx<MemberUnit>;
let withScan: WithTenantTx<ScanUnit>;
let withSelf: WithTenantTx<MemberSelfServiceUnit>;
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
  withMember = makeWithMemberUnit(withTenantTx, { clock: CLOCK, ids: { next: randomUUID } });
  withScan = makeWithScanUnit(withTenantTx);
  withSelf = makeWithMemberSelfUnit(withTenantTx);
});

afterAll(async () => {
  await source.destroy();
  await db.drop();
});

async function one(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await db.admin.query(sql, params);
  return (rows[0] as { id: string }).id;
}

async function gym() {
  counter += 1;
  const tenantId = await one(
    "INSERT INTO tenants (name, subdomain, timezone, currency, branding) VALUES ($1, $1, 'America/Toronto', 'CAD', $2) RETURNING id",
    [`self-gym-${counter}`, JSON.stringify({ primary_color: "#112233" })],
  );
  const staffUserId = await one(
    "INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id",
    [tenantId, `staff-${counter}@example.test`],
  );
  await db.admin.query(
    "INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee) VALUES ($1, 'default', 'Default', 2000, 5000)",
    [tenantId],
  );
  return {
    tenantId,
    creator: {
      roles: ["staff"] as const,
      tenantId,
      userId: staffUserId,
      requestId: `req-${counter}`,
    },
  };
}

type Gym = Awaited<ReturnType<typeof gym>>;

async function member(g: Gym, fullName: string) {
  counter += 1;
  const email = `m-${counter}@example.test`;
  const created = await makeCreateMember({
    withUnit: withMember,
    clock: CLOCK,
    codes: randomCodes,
  })({ fullName, email, joinDate: "2026-09-01" }, g.creator);
  if (!created.ok) throw new Error(created.error.message);
  const userId = await one("SELECT id FROM users WHERE tenant_id = $1 AND email = $2", [
    g.tenantId,
    email,
  ]);
  const caller: MemberSelfCaller = { roles: ["member"], tenantId: g.tenantId, userId };
  return { memberId: created.value.memberId, barcode: created.value.barcode, caller };
}

async function scanAt(g: Gym, barcode: string, at: string): Promise<void> {
  const scan = makeRecordScan({
    withUnit: (t, fn) => withScan(t, fn),
    clock: { now: () => new Date(at) },
  });
  const result = await scan({ barcode }, g.creator);
  if (!result.ok || !result.value.found) throw new Error("expected the scan to be stored");
}

const deps = {
  withUnit: (t: string, fn: (u: MemberSelfServiceUnit) => Promise<unknown>) =>
    withSelf(t, fn as never),
  clock: CLOCK,
};
const getCard = makeGetMyCard(deps as never);
const getProfile = makeGetMyProfile(deps as never);
const getAttendance = makeGetMyAttendance(deps as never);

describe("a member reads only their own record", () => {
  it("returns the caller's own card and profile even when another member's id is asked for", async () => {
    const g = await gym();
    const ada = await member(g, "Ada Lovelace");
    const grace = await member(g, "Grace Hopper");

    const card = await getCard({ memberId: grace.memberId } as never, ada.caller);
    expect(card).toMatchObject({
      ok: true,
      value: {
        gym: { primaryColor: "#112233" },
        barcode: ada.barcode,
        name: "Ada Lovelace",
        membershipStatus: "active",
      },
    });
    const profile = await getProfile({ memberId: grace.memberId } as never, ada.caller);
    expect(profile).toMatchObject({
      ok: true,
      value: { name: "Ada Lovelace", planName: "Default" },
    });
  });

  it("shows only the caller's visits and counts, never another member's", async () => {
    const g = await gym();
    const ada = await member(g, "Ada Lovelace");
    const grace = await member(g, "Grace Hopper");
    await scanAt(g, ada.barcode, "2026-11-20T15:00:00.000Z");
    await scanAt(g, grace.barcode, "2026-11-21T15:00:00.000Z");
    await scanAt(g, grace.barcode, "2026-11-22T15:00:00.000Z");

    const result = await getAttendance({ memberId: grace.memberId } as never, ada.caller);
    expect(result).toMatchObject({
      ok: true,
      value: {
        visitsThisMonth: 1,
        visitsLastMonth: 0,
        months: [{ month: "2026-11", visits: [{ day: "2026-11-20", time: "10:00" }] }],
        nextCursor: null,
      },
    });
  });

  it("leaves repeat scans out of the list and the counts, and pages without gaps", async () => {
    const g = await gym();
    const ada = await member(g, "Ada Lovelace");
    // In time order, since the scan code treats a scan before a later one as a repeat.
    await scanAt(g, ada.barcode, "2026-10-30T15:00:00.000Z");
    await scanAt(g, ada.barcode, "2026-11-20T15:00:00.000Z");
    await scanAt(g, ada.barcode, "2026-11-20T15:05:00.000Z");
    await scanAt(g, ada.barcode, "2026-11-22T15:00:00.000Z");

    const first = await getAttendance({ limit: 2 }, ada.caller);
    if (!first.ok) throw new Error(first.error.message);
    expect(first.value).toMatchObject({ visitsThisMonth: 2, visitsLastMonth: 1 });
    expect(first.value.months).toHaveLength(1);
    expect(first.value.months[0]?.visits.map((v) => v.day)).toEqual(["2026-11-22", "2026-11-20"]);
    expect(first.value.nextCursor).not.toBeNull();

    const second = await getAttendance({ limit: 2, cursor: first.value.nextCursor }, ada.caller);
    if (!second.ok) throw new Error(second.error.message);
    expect(second.value.months).toMatchObject([{ month: "2026-10" }]);
    expect(second.value.nextCursor).toBeNull();
  });

  it("returns paused and cancelled as distinct values", async () => {
    const g = await gym();
    const ada = await member(g, "Ada Lovelace");
    await db.admin.query(
      "UPDATE membership_periods SET valid_to = '2026-11-01' WHERE tenant_id = $1 AND member_id = $2 AND valid_to IS NULL",
      [g.tenantId, ada.memberId],
    );
    await db.admin.query(
      "INSERT INTO membership_periods (tenant_id, member_id, plan_id, status, valid_from) SELECT tenant_id, member_id, plan_id, 'paused', '2026-11-01' FROM membership_periods WHERE tenant_id = $1 AND member_id = $2 ORDER BY valid_from DESC LIMIT 1",
      [g.tenantId, ada.memberId],
    );
    const card = await getCard(undefined, ada.caller);
    expect(card).toMatchObject({
      ok: true,
      value: { membershipStatus: "paused", standing: "inactive" },
    });
  });

  it("answers not found for a user who is not a member, and for a user of another gym", async () => {
    const a = await gym();
    const b = await gym();
    const ada = await member(a, "Ada Lovelace");
    const staffCaller: MemberSelfCaller = {
      roles: ["member"],
      tenantId: a.tenantId,
      userId: a.creator.userId,
    };
    expect(await getCard(undefined, staffCaller)).toMatchObject({
      ok: false,
      error: { kind: "not_found" },
    });
    const crossGym: MemberSelfCaller = { ...ada.caller, tenantId: b.tenantId };
    expect(await getProfile(undefined, crossGym)).toMatchObject({
      ok: false,
      error: { kind: "not_found" },
    });
    expect(await getAttendance({}, crossGym)).toMatchObject({
      ok: false,
      error: { kind: "not_found" },
    });
  });
});
