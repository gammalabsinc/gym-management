import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeSessions } from "../../app/sessions";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { expiresAfter } from "./session-lifetime";
import { sessionTokens } from "./session-tokens";
import { makeSessionStore } from "./sessions-sql";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
const HOUR = 3_600_000;

let db: TestDatabase;
let app: pg.Client;
let now = new Date("2026-01-10T12:00:00Z");

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

const store = () =>
  makeSessionStore({ query: async (sql, params) => (await app.query(sql, params)).rows });

const sessions = () =>
  makeSessions({
    store: store(),
    tokens: sessionTokens,
    clock: { now: () => now },
    ids: { next: () => randomUUID() },
    expiryFor: expiresAfter(24 * HOUR),
  });

async function codeOf(attempt: Promise<unknown>): Promise<string | undefined> {
  try {
    await attempt;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("sessions on a real Postgres", () => {
  it("authenticates a freshly issued token", async () => {
    const { token } = await sessions().issue("sub-live");
    const result = await sessions().authenticate(token);
    expect(result).toMatchObject({ ok: true, value: { subject: "sub-live" } });
  });

  it("stores the hash and not the token, so a dump yields no usable session", async () => {
    const { token } = await sessions().issue("sub-dump");
    const { rows } = await app.query("SELECT * FROM sessions WHERE auth_subject = 'sub-dump'");
    expect(JSON.stringify(rows)).not.toContain(token);
    const stolen = (rows[0] as { token_hash: string }).token_hash;
    expect((await sessions().authenticate(stolen)).ok).toBe(false);
  });

  it("fails a revoked session on the next request", async () => {
    const { token } = await sessions().issue("sub-out");
    await sessions().signOut(token);
    expect((await sessions().authenticate(token)).ok).toBe(false);
  });

  it("fails a session once its expiry has passed", async () => {
    const { token } = await sessions().issue("sub-old");
    const issuedAt = now;
    now = new Date(issuedAt.getTime() + 25 * HOUR);
    try {
      expect((await sessions().authenticate(token)).ok).toBe(false);
    } finally {
      now = issuedAt;
    }
  });

  it("revokes every live session of one account and leaves others alone", async () => {
    const one = await sessions().issue("sub-many");
    const two = await sessions().issue("sub-many");
    const other = await sessions().issue("sub-other");
    expect(await sessions().revokeAll("sub-many")).toBe(2);
    expect(await sessions().revokeAll("sub-many")).toBe(0);
    expect((await sessions().authenticate(one.token)).ok).toBe(false);
    expect((await sessions().authenticate(two.token)).ok).toBe(false);
    expect((await sessions().authenticate(other.token)).ok).toBe(true);
  });

  it("keeps the first revocation time when a session is signed out twice", async () => {
    const { token } = await sessions().issue("sub-twice");
    await sessions().signOut(token);
    const first = await app.query(
      "SELECT revoked_at FROM sessions WHERE auth_subject = 'sub-twice'",
    );
    now = new Date(now.getTime() + HOUR);
    await sessions().signOut(token);
    const second = await app.query(
      "SELECT revoked_at FROM sessions WHERE auth_subject = 'sub-twice'",
    );
    now = new Date(now.getTime() - HOUR);
    expect(second.rows).toEqual(first.rows);
  });

  it("returns null for an unknown hash", async () => {
    expect(await store().findByTokenHash("0".repeat(64))).toBeNull();
  });

  it("is refused a second session with the same token hash", async () => {
    const tokenHash = sessionTokens.generate().tokenHash;
    const base = {
      tokenHash,
      subject: "sub-dup",
      createdAt: now,
      expiresAt: new Date(now.getTime() + HOUR),
    };
    await store().insert({ ...base, id: randomUUID() });
    expect(await codeOf(store().insert({ ...base, id: randomUUID() }))).toBe("23505");
  });

  it("rejects rows the table must never hold", async () => {
    const insert = (hash: string, subject: string, expires: Date) =>
      store().insert({
        id: randomUUID(),
        tokenHash: hash,
        subject,
        createdAt: now,
        expiresAt: expires,
      });
    const later = new Date(now.getTime() + HOUR);
    expect(await codeOf(insert("not-a-hash", "sub-x", later))).toBe("23514");
    expect(await codeOf(insert("a".repeat(64), "", later))).toBe("23514");
    expect(await codeOf(insert("b".repeat(64), "sub-x", now))).toBe("23514");
  });

  it("lets the app role set revoked_at and nothing else on a session", async () => {
    const { token } = await sessions().issue("sub-guard");
    const hash = sessionTokens.hash(token);
    expect(
      await codeOf(
        app.query(
          "UPDATE sessions SET expires_at = now() + interval '1 year' WHERE token_hash = $1",
          [hash],
        ),
      ),
    ).toBe("42501");
    expect(
      await codeOf(
        app.query("UPDATE sessions SET auth_subject = 'sub-thief' WHERE token_hash = $1", [hash]),
      ),
    ).toBe("42501");
    expect(await codeOf(app.query("DELETE FROM sessions WHERE token_hash = $1", [hash]))).toBe(
      "42501",
    );
  });
});
