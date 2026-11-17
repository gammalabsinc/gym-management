import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OnboardGymInput } from "../domain/onboarding";
import { migrateDatabase } from "../infra/db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../infra/db/roles";
import { createTestDatabase, type TestDatabase } from "../infra/db/test-database";
import { runBackfill } from "./backfill";
import { onboardGym } from "./onboard";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
const gym: OnboardGymInput = {
  name: "Iron Works",
  subdomain: "ironworks",
  timezone: "America/Toronto",
  currency: "CAD",
  ownerEmail: "owner@ironworks.test",
  ownerName: "Olive Owner",
  admissionFee: 5000,
  monthlyFee: 4000,
};

let db: TestDatabase;
let url: string;
let tenantId: string;
let dir: string;

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  url = db.urlFor(APP_ROLE, PASSWORDS.appPassword);
  const onboarded = await onboardGym(url, gym);
  if (!onboarded.ok) throw new Error("onboarding failed");
  tenantId = onboarded.value.tenantId;
  dir = await mkdtemp(join(tmpdir(), "backfill-"));
});

afterAll(async () => {
  await db.drop();
});

async function fileWith(content: string, name: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

async function memberCount(): Promise<number> {
  const { rows } = await db.admin.query("SELECT count(*) AS n FROM members WHERE tenant_id = $1", [
    tenantId,
  ]);
  return Number((rows[0] as { n: string }).n);
}

const member = { email: "ada@x.test", fullName: "Ada", joinDate: "2026-10-05" };

describe("runBackfill", () => {
  it("writes nothing on a dry run", async () => {
    const file = await fileWith(JSON.stringify({ members: [member] }), "dry.json");
    const result = await runBackfill(url, { tenantId, file, dryRun: true });
    expect(result.ok).toBe(true);
    expect(await memberCount()).toBe(0);
  });

  it("loads the members on a real run", async () => {
    const file = await fileWith(JSON.stringify({ members: [member] }), "real.json");
    const result = await runBackfill(url, { tenantId, file, dryRun: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.members[0]?.outcome).toBe("created");
    expect(await memberCount()).toBe(1);
  });

  it("returns the problem of a file that is not valid, before touching the database", async () => {
    const file = await fileWith("not json", "bad.json");
    const result = await runBackfill("postgres://nowhere.invalid/db", {
      tenantId,
      file,
      dryRun: false,
    });
    expect(result.ok).toBe(false);
  });
});
