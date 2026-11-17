import { randomUUID } from "node:crypto";
import type pg from "pg";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeFindMembership } from "../../app/gym-membership";
import { makeResolveRequestSession } from "../../app/request-session";
import { makeSelectGym, NOT_A_MEMBER_MESSAGE } from "../../app/select-gym";
import { makeSessions } from "../../app/sessions";
import type { Role } from "../../domain/permissions";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { makeWithTenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { makeAccountLookup, type RunInTransaction } from "../google/accounts-sql";
import { expiresAfter } from "../sessions/session-lifetime";
import { sessionTokens } from "../sessions/session-tokens";
import { makeSessionStore } from "../sessions/sessions-sql";
import { makeWithGymPickerUnit } from "./gym-picker-unit";
import { makeGymRegistry } from "./gym-registry-sql";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
const HOUR = 3_600_000;

let db: TestDatabase;
let app: pg.Client;
let source: DataSource;
let counter = 0;

const run = async (sql: string, params: unknown[]) => (await app.query(sql, params)).rows;

const transact: RunInTransaction = async (fn) => {
  await app.query("BEGIN");
  try {
    const result = await fn({ query: run });
    await app.query("COMMIT");
    return result;
  } catch (error) {
    await app.query("ROLLBACK");
    throw error;
  }
};

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  app = await db.connect(APP_ROLE, PASSWORDS.appPassword);
  source = new DataSource({
    ...dataSourceOptions(db.urlFor(APP_ROLE, PASSWORDS.appPassword)),
    extra: { max: 4 },
  });
  await source.initialize();
});

afterAll(async () => {
  await source.destroy();
  await app.end();
  await db.drop();
});

const store = makeSessionStore({ query: run });
const findMembership = () =>
  makeFindMembership({
    accounts: makeAccountLookup(transact),
    withUnit: makeWithGymPickerUnit(makeWithTenantTx(source)),
  });
const sessions = () =>
  makeSessions({
    store,
    tokens: sessionTokens,
    clock: { now: () => new Date() },
    ids: { next: () => randomUUID() },
    expiryFor: expiresAfter(24 * HOUR),
  });
const selectGym = () =>
  makeSelectGym({
    gyms: makeGymRegistry({ query: run }),
    findMembership: findMembership(),
    sessions: store,
  });
const resolve = () =>
  makeResolveRequestSession({ sessions: sessions(), findMembership: findMembership() });

async function one(sql: string, params: unknown[]): Promise<string> {
  const { rows } = await db.admin.query(sql, params);
  return (rows[0] as { id: string }).id;
}

async function gym(isActive = true): Promise<string> {
  counter += 1;
  return one(
    `INSERT INTO tenants (name, subdomain, timezone, currency, is_active)
     VALUES ($1, $2, 'America/Toronto', 'CAD', $3) RETURNING id`,
    [`Gym ${counter}`, `gym-${counter}`, isActive],
  );
}

async function person(tenantId: string, subject: string, roles: Role[]): Promise<string> {
  counter += 1;
  const userId = await one(
    "INSERT INTO users (tenant_id, email, auth_subject) VALUES ($1, $2, $3) RETURNING id",
    [tenantId, `person-${counter}@example.test`, subject],
  );
  for (const role of roles) {
    await db.admin.query("INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
      tenantId,
      userId,
      role,
    ]);
  }
  return userId;
}

/** A signed in person with one session, the way the sign in ticket hands it out. */
async function signedIn(subject: string) {
  const { token } = await sessions().issue(subject);
  const authenticated = await sessions().authenticate(token);
  if (!authenticated.ok) throw new Error("a fresh session must authenticate");
  return { token, header: `Bearer ${token}`, ...authenticated.value };
}

describe("tenant resolution on a real database", () => {
  it("binds the session to the gym and then resolves every request to that gym and user", async () => {
    const subject = `sub-${randomUUID()}`;
    const alpha = await gym();
    const userId = await person(alpha, subject, ["staff"]);
    const session = await signedIn(subject);

    expect(await resolve()(session.header)).toEqual({ subject, userId: null, tenantId: null });
    const picked = await selectGym()({ tenantId: alpha }, session);
    expect(picked).toMatchObject({ ok: true, value: { tenantId: alpha, roles: ["staff"] } });
    expect(await resolve()(session.header)).toEqual({ subject, userId, tenantId: alpha });
  });

  it("refuses a valid session that holds no role in the gym, and binds nothing", async () => {
    const subject = `sub-${randomUUID()}`;
    const mine = await gym();
    const theirs = await gym();
    await person(mine, subject, ["member"]);
    await person(theirs, `other-${randomUUID()}`, ["owner"]);
    const session = await signedIn(subject);

    const result = await selectGym()({ tenantId: theirs }, session);
    expect(result).toMatchObject({ ok: false, error: { kind: "forbidden" } });
    expect(!result.ok && result.error.message).toBe(NOT_A_MEMBER_MESSAGE);
    expect(JSON.stringify(result)).not.toContain("Gym");
    expect(await resolve()(session.header)).toMatchObject({ tenantId: null });
  });

  it("refuses a person whose user row there holds no role", async () => {
    const subject = `sub-${randomUUID()}`;
    const roleless = await gym();
    await person(roleless, subject, []);
    const result = await selectGym()({ tenantId: roleless }, await signedIn(subject));
    expect(result).toMatchObject({ ok: false, error: { kind: "forbidden" } });
  });

  it("gives a generic not found for an unknown gym and for a gym that is switched off", async () => {
    const subject = `sub-${randomUUID()}`;
    const off = await gym(false);
    await person(off, subject, ["owner"]);
    const session = await signedIn(subject);
    const notFound = { ok: false, error: { kind: "not_found", message: "Not found" } };

    expect(await selectGym()({ tenantId: randomUUID() }, session)).toEqual(notFound);
    expect(await selectGym()({ tenantId: off }, session)).toEqual(notFound);
    expect(await selectGym()({ tenantId: "x' OR '1'='1" }, session)).toEqual(notFound);
  });

  it("moves the session to another gym when the person picks again", async () => {
    const subject = `sub-${randomUUID()}`;
    const first = await gym();
    const second = await gym();
    await person(first, subject, ["owner"]);
    const secondUser = await person(second, subject, ["member"]);
    const session = await signedIn(subject);

    await selectGym()({ tenantId: first }, session);
    await selectGym()({ tenantId: second }, session);
    expect(await resolve()(session.header)).toEqual({
      subject,
      userId: secondUser,
      tenantId: second,
    });
  });

  it("drops back to an identity session when the role is removed after the gym was picked", async () => {
    const subject = `sub-${randomUUID()}`;
    const alpha = await gym();
    const userId = await person(alpha, subject, ["staff"]);
    const session = await signedIn(subject);
    await selectGym()({ tenantId: alpha }, session);

    await db.admin.query("DELETE FROM user_roles WHERE user_id = $1", [userId]);
    expect(await resolve()(session.header)).toEqual({ subject, userId: null, tenantId: null });
  });

  it("does not bind a session that was signed out, and resolves it to nobody", async () => {
    const subject = `sub-${randomUUID()}`;
    const alpha = await gym();
    await person(alpha, subject, ["staff"]);
    const session = await signedIn(subject);
    await sessions().signOut(session.token);

    await selectGym()({ tenantId: alpha }, session);
    const { rows } = await db.admin.query("SELECT gym_id FROM sessions WHERE id = $1", [
      session.sessionId,
    ]);
    expect(rows).toEqual([{ gym_id: null }]);
    expect(await resolve()(session.header)).toBeNull();
  });

  it("keeps two people in two gyms apart: each session resolves to its own gym only", async () => {
    const alpha = await gym();
    const bravo = await gym();
    const subjectA = `sub-${randomUUID()}`;
    const subjectB = `sub-${randomUUID()}`;
    await person(alpha, subjectA, ["owner"]);
    await person(bravo, subjectB, ["owner"]);
    const a = await signedIn(subjectA);
    const b = await signedIn(subjectB);

    expect(await selectGym()({ tenantId: bravo }, a)).toMatchObject({ ok: false });
    expect(await selectGym()({ tenantId: alpha }, b)).toMatchObject({ ok: false });
    await selectGym()({ tenantId: alpha }, a);
    await selectGym()({ tenantId: bravo }, b);
    expect(await resolve()(a.header)).toMatchObject({ tenantId: alpha });
    expect(await resolve()(b.header)).toMatchObject({ tenantId: bravo });
  });

  it("lets the app role set the gym of a session and nothing else about it", async () => {
    const session = await signedIn(`sub-${randomUUID()}`);
    const alpha = await gym();
    await app.query("UPDATE sessions SET gym_id = $2 WHERE id = $1", [session.sessionId, alpha]);
    await expect(
      app.query("UPDATE sessions SET auth_subject = 'someone-else' WHERE id = $1", [
        session.sessionId,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      app.query("UPDATE sessions SET gym_id = $2 WHERE id = $1", [session.sessionId, randomUUID()]),
    ).rejects.toMatchObject({ code: "23503" });
  });
});
