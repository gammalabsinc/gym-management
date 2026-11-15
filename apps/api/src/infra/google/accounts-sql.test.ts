import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLAIM_EMAIL_SETTING, CLAIM_SUBJECT_SETTING } from "../db/claim-settings";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { makeAccountDirectory, type RunInTransaction } from "./accounts-sql";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };

let db: TestDatabase;
let app: pg.Client;
let counter = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  app = await db.connect(APP_ROLE, PASSWORDS.appPassword);
});

afterAll(async () => {
  await app.end();
  await db.drop();
});

async function gym(): Promise<string> {
  counter += 1;
  const { rows } = await app.query(
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $1, 'America/Toronto', 'CAD') RETURNING id",
    [`gym-${counter}`],
  );
  return (rows[0] as { id: string }).id;
}

/** A row added by email, the way an owner adds a member or staff before they sign in. */
async function invite(
  tenantId: string,
  email: string,
  subject: string | null = null,
): Promise<string> {
  const { rows } = await db.admin.query(
    "INSERT INTO users (tenant_id, email, auth_subject) VALUES ($1, $2, $3) RETURNING id",
    [tenantId, email, subject],
  );
  return (rows[0] as { id: string }).id;
}

async function subjectOf(userId: string): Promise<string | null> {
  const { rows } = await db.admin.query("SELECT auth_subject FROM users WHERE id = $1", [userId]);
  return (rows[0] as { auth_subject: string | null }).auth_subject;
}

/** One transaction on the app role's connection, the way the API will run a sign in. */
const transact: RunInTransaction = async (fn) => {
  await app.query("BEGIN");
  try {
    const result = await fn({ query: async (sql, params) => (await app.query(sql, params)).rows });
    await app.query("COMMIT");
    return result;
  } catch (error) {
    await app.query("ROLLBACK");
    throw error;
  }
};

const directory = () => makeAccountDirectory(transact);

describe("makeAccountDirectory.claim", () => {
  it("links every row waiting for the email, across gyms", async () => {
    const [a, b] = [await gym(), await gym()];
    const inA = await invite(a, "multi@example.com");
    const inB = await invite(b, "multi@example.com");
    const gyms = await directory().claim({ subject: "sub-multi", email: "multi@example.com" });
    expect(gyms).toHaveLength(2);
    expect(gyms).toEqual(
      expect.arrayContaining([
        { userId: inA, tenantId: a },
        { userId: inB, tenantId: b },
      ]),
    );
    expect(await subjectOf(inA)).toBe("sub-multi");
    expect(await subjectOf(inB)).toBe("sub-multi");
  });

  it("matches the email without regard to case", async () => {
    const t = await gym();
    const id = await invite(t, "casey@example.com");
    const gyms = await directory().claim({ subject: "sub-casey", email: "Casey@Example.COM" });
    expect(gyms).toEqual([{ userId: id, tenantId: t }]);
  });

  it("never takes over a row that belongs to another Google account", async () => {
    const t = await gym();
    const id = await invite(t, "taken@example.com", "sub-owner");
    const thief = await directory().claim({ subject: "sub-thief", email: "taken@example.com" });
    expect(thief).toEqual([]);
    expect(await subjectOf(id)).toBe("sub-owner");
  });

  it("signs in an email with no rows with an empty gym list and creates nothing", async () => {
    const before = await db.admin.query("SELECT count(*)::int AS n FROM users");
    const gyms = await directory().claim({ subject: "sub-nobody", email: "nobody@example.com" });
    expect(gyms).toEqual([]);
    const after = await db.admin.query("SELECT count(*)::int AS n FROM users");
    expect(after.rows).toEqual(before.rows);
  });

  it("returns the same gyms on a second sign in and changes nothing", async () => {
    const t = await gym();
    await invite(t, "again@example.com");
    const first = await directory().claim({ subject: "sub-again", email: "again@example.com" });
    const second = await directory().claim({ subject: "sub-again", email: "again@example.com" });
    expect(second).toEqual(first);
  });

  it("keeps the same user when the email on the Google account changes", async () => {
    const t = await gym();
    const id = await invite(t, "old@example.com");
    await directory().claim({ subject: "sub-moved", email: "old@example.com" });
    const later = await directory().claim({ subject: "sub-moved", email: "new@example.com" });
    expect(later).toEqual([{ userId: id, tenantId: t }]);
    const { rows } = await db.admin.query("SELECT email FROM users WHERE tenant_id = $1", [t]);
    expect(rows).toEqual([{ email: "old@example.com" }]);
  });

  it("leaves a second row in the same gym unclaimed instead of failing on the unique subject", async () => {
    const t = await gym();
    const first = await invite(t, "first@example.com");
    const second = await invite(t, "second@example.com");
    await directory().claim({ subject: "sub-two-emails", email: "first@example.com" });
    const gyms = await directory().claim({
      subject: "sub-two-emails",
      email: "second@example.com",
    });
    expect(gyms).toEqual([{ userId: first, tenantId: t }]);
    expect(await subjectOf(second)).toBeNull();
  });

  it("leaves the app role blind to user rows again once the sign in transaction ends", async () => {
    const t = await gym();
    await invite(t, "blind@example.com");
    await directory().claim({ subject: "sub-blind", email: "blind@example.com" });
    const { rows } = await app.query("SELECT count(*)::int AS n FROM users");
    expect(rows).toEqual([{ n: 0 }]);
  });

  it("lets a claim reach only unlinked rows for its own email, whatever the statement says", async () => {
    const t = await gym();
    const mine = await invite(t, "reach@example.com");
    const someoneElses = await invite(t, "other@example.com");
    const linkedElsewhere = await invite(t, "linked@example.com", "sub-linked");
    await transact(async (executor) => {
      await executor.query("SELECT set_config($1, $2, true), set_config($3, $4, true)", [
        CLAIM_EMAIL_SETTING,
        "reach@example.com",
        CLAIM_SUBJECT_SETTING,
        "sub-reach",
      ]);
      await executor.query("UPDATE users SET name = 'hacked', auth_subject = 'sub-reach'", []);
    });
    const { rows } = await db.admin.query("SELECT id, name FROM users WHERE id = ANY($1)", [
      [mine, someoneElses, linkedElsewhere],
    ]);
    const named = (rows as { id: string; name: string | null }[]).filter(
      (r) => r.name === "hacked",
    );
    expect(named.map((r) => r.id)).toEqual([mine]);
  });

  it("refuses to link a row to a subject other than the one claiming", async () => {
    const t = await gym();
    await invite(t, "swap@example.com");
    const attempt = transact(async (executor) => {
      await executor.query("SELECT set_config($1, $2, true), set_config($3, $4, true)", [
        CLAIM_EMAIL_SETTING,
        "swap@example.com",
        CLAIM_SUBJECT_SETTING,
        "sub-claimer",
      ]);
      await executor.query("UPDATE users SET auth_subject = 'sub-someone-else'", []);
    });
    await expect(attempt).rejects.toMatchObject({ code: "42501" });
  });
});
