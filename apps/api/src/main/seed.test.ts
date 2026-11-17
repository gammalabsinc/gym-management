import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localDateIn } from "../domain/calendar";
import { DEV_GYMS, type SeedScenario } from "../domain/seed-data";
import { type InvoiceDue, type Standing, standingOf } from "../domain/standing";
import { migrateDatabase } from "../infra/db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../infra/db/roles";
import { createTestDatabase, type TestDatabase } from "../infra/db/test-database";
import { seedDevData } from "./seed";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
const EXPECTED_STANDING: Readonly<Record<SeedScenario, Standing>> = {
  paid: "paid",
  due_soon: "due_soon",
  overdue: "overdue",
  paused: "inactive",
  cancelled: "inactive",
};

let db: TestDatabase;
let url: string;

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  url = db.urlFor(APP_ROLE, PASSWORDS.appPassword);
});

afterAll(async () => {
  await db.drop();
});

async function rows<Row>(sql: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.admin.query(sql, params)).rows as Row[];
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const [row] = await rows<{ n: string }>(sql, params);
  return Number(row?.n);
}

interface MemberState {
  readonly status: "active" | "paused" | "cancelled";
  readonly invoices: readonly InvoiceDue[];
}

/** What standing reads for one member, taken from the rows the seed wrote. */
async function stateOf(tenantId: string, email: string): Promise<MemberState> {
  const [period] = await rows<{ status: MemberState["status"] }>(
    `SELECT p.status FROM membership_periods p
       JOIN members m ON m.id = p.member_id
       JOIN users u ON u.id = m.user_id
      WHERE p.tenant_id = $1 AND u.email = $2 AND p.valid_to IS NULL`,
    [tenantId, email],
  );
  const invoices = await rows<{ dueDate: string; amountDue: number; isVoid: boolean }>(
    `SELECT i.due_date::text AS "dueDate", i.is_void AS "isVoid",
            (i.total - COALESCE(SUM(a.amount), 0))::int AS "amountDue"
       FROM invoices i
       JOIN members m ON m.id = i.member_id
       JOIN users u ON u.id = m.user_id
       LEFT JOIN payment_allocations a ON a.invoice_id = i.id
      WHERE i.tenant_id = $1 AND u.email = $2
      GROUP BY i.id`,
    [tenantId, email],
  );
  if (period === undefined) throw new Error(`No current period for ${email}`);
  return { status: period.status, invoices };
}

describe("seedDevData against a real database", () => {
  it("makes both gyms with an owner, a staff member and every member", async () => {
    const seeded = await seedDevData(url);
    expect(
      seeded.map(({ subdomain, created, members }) => ({ subdomain, created, members })),
    ).toEqual(
      DEV_GYMS.map((fixture) => ({
        subdomain: fixture.gym.subdomain,
        created: true,
        members: fixture.members.length,
      })),
    );
    for (const fixture of DEV_GYMS) {
      const tenant = seeded.find((gym) => gym.subdomain === fixture.gym.subdomain);
      if (tenant === undefined) throw new Error("A seeded gym is missing from the result");
      const roles = await rows<{ role: string; email: string }>(
        `SELECT r.role, u.email FROM user_roles r JOIN users u ON u.id = r.user_id
          WHERE r.tenant_id = $1 AND r.role <> 'member' ORDER BY r.role`,
        [tenant.tenantId],
      );
      expect(roles).toEqual([
        { role: "owner", email: fixture.gym.ownerEmail },
        { role: "staff", email: fixture.staff.email },
      ]);
      expect(
        await count("SELECT count(*) AS n FROM members WHERE tenant_id = $1", [tenant.tenantId]),
      ).toBe(fixture.members.length);
    }
  });

  it("puts every member in the standing its scenario promises", async () => {
    const tenants = await rows<{ id: string; subdomain: string }>(
      "SELECT id, subdomain FROM tenants",
    );
    for (const fixture of DEV_GYMS) {
      const tenant = tenants.find((row) => row.subdomain === fixture.gym.subdomain);
      if (tenant === undefined) throw new Error("A seeded gym is missing from the database");
      const today = localDateIn(new Date(), fixture.gym.timezone);
      for (const member of fixture.members) {
        const state = await stateOf(tenant.id, member.email);
        const standing = standingOf({
          today,
          warnDaysBefore: 5,
          redDaysAfter: 5,
          membershipStatus: state.status,
          invoices: state.invoices,
        });
        expect(standing, member.email).toEqual({
          ok: true,
          value: EXPECTED_STANDING[member.scenario],
        });
      }
    }
  });

  it("covers every standing in each gym", () => {
    for (const fixture of DEV_GYMS) {
      const standings = new Set(
        fixture.members.map((member) => EXPECTED_STANDING[member.scenario]),
      );
      expect([...standings].sort()).toEqual(["due_soon", "inactive", "overdue", "paid"]);
    }
  });

  it("records every payment with its audit event, and nothing for the other members", async () => {
    const paid = DEV_GYMS.flatMap((fixture) => fixture.members).filter(
      (member) => member.scenario === "paid",
    );
    expect(await count("SELECT count(*) AS n FROM payments")).toBe(paid.length);
    expect(await count("SELECT count(*) AS n FROM payment_allocations")).toBe(paid.length);
    expect(
      await count("SELECT count(*) AS n FROM audit_events WHERE action = 'payment.recorded'"),
    ).toBe(paid.length);
  });

  it("is repeatable: a second run reports the gyms and writes nothing", async () => {
    const before = await count("SELECT count(*) AS n FROM audit_events");
    const again = await seedDevData(url);
    expect(again.every((gym) => !gym.created && gym.members === 0)).toBe(true);
    expect(await count("SELECT count(*) AS n FROM audit_events")).toBe(before);
    expect(await count("SELECT count(*) AS n FROM tenants")).toBe(DEV_GYMS.length);
  });
});
