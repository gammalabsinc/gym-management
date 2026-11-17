import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OnboardGymInput } from "../domain/onboarding";
import { migrateDatabase } from "../infra/db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../infra/db/roles";
import { createTestDatabase, type TestDatabase } from "../infra/db/test-database";
import { onboardGym } from "./onboard";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };

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

const input: OnboardGymInput = {
  name: "Iron Works",
  subdomain: "ironworks",
  timezone: "America/Toronto",
  currency: "CAD",
  ownerEmail: "owner@ironworks.test",
  ownerName: "Olive Owner",
  admissionFee: 5000,
  monthlyFee: 4000,
};

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await db.admin.query(sql, params);
  return Number((rows[0] as { n: string }).n);
}

describe("onboardGym against a real database", () => {
  it("creates the gym, its owner, the default plan and the audit trail together", async () => {
    const result = await onboardGym(url, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ subdomain: "ironworks", created: true });
    const { tenantId } = result.value;

    const tenant = await db.admin.query(
      "SELECT name, timezone, currency FROM tenants WHERE id = $1",
      [tenantId],
    );
    expect(tenant.rows).toEqual([
      { name: "Iron Works", timezone: "America/Toronto", currency: "CAD" },
    ]);
    const roles = await db.admin.query(
      "SELECT r.role, u.email FROM user_roles r JOIN users u ON u.id = r.user_id WHERE r.tenant_id = $1",
      [tenantId],
    );
    expect(roles.rows).toEqual([{ role: "owner", email: "owner@ironworks.test" }]);
    const plans = await db.admin.query(
      "SELECT admission_fee, monthly_fee FROM plans WHERE tenant_id = $1",
      [tenantId],
    );
    expect(plans.rows).toEqual([{ admission_fee: 5000, monthly_fee: 4000 }]);
    const audit = await db.admin.query(
      "SELECT action FROM audit_events WHERE tenant_id = $1 ORDER BY action",
      [tenantId],
    );
    expect(audit.rows.map((row: { action: string }) => row.action)).toEqual([
      "plan.created",
      "role.assigned",
      "tenant.created",
    ]);
  });

  it("is idempotent: a second run changes nothing and returns the same gym", async () => {
    const first = await onboardGym(url, {
      ...input,
      subdomain: "repeat",
      ownerEmail: "r@repeat.test",
    });
    const second = await onboardGym(url, {
      ...input,
      subdomain: "repeat",
      ownerEmail: "r@repeat.test",
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value).toMatchObject({ created: false, tenantId: first.value.tenantId });
    expect(await count("SELECT count(*) AS n FROM tenants WHERE subdomain = 'repeat'")).toBe(1);
    expect(
      await count("SELECT count(*) AS n FROM users WHERE tenant_id = $1", [first.value.tenantId]),
    ).toBe(1);
    expect(
      await count("SELECT count(*) AS n FROM plans WHERE tenant_id = $1", [first.value.tenantId]),
    ).toBe(1);
  });

  it("keeps each gym's rows apart", async () => {
    const other = await onboardGym(url, {
      ...input,
      subdomain: "other",
      ownerEmail: "o@other.test",
    });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(
      await count(
        "SELECT count(*) AS n FROM users WHERE tenant_id = $1 AND email = 'owner@ironworks.test'",
        [other.value.tenantId],
      ),
    ).toBe(0);
  });

  it("rejects an invalid gym without touching the database", async () => {
    const before = await count("SELECT count(*) AS n FROM tenants");
    const result = await onboardGym(url, { ...input, subdomain: "Bad Name" });
    expect(result.ok).toBe(false);
    expect(await count("SELECT count(*) AS n FROM tenants")).toBe(before);
  });
});
