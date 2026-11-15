import { describe, expect, it } from "vitest";
import { expiresAfter } from "../infra/sessions/session-lifetime";
import type { NewSession, SessionStore, SessionTokens, StoredSession } from "./ports";
import { makeSessions } from "./sessions";

const START = new Date("2026-01-10T12:00:00Z");
const HOUR = 3_600_000;

function fakeStore() {
  const rows = new Map<string, NewSession & { revokedAt: Date | null }>();
  const store: SessionStore = {
    async insert(session) {
      rows.set(session.tokenHash, { ...session, revokedAt: null });
    },
    async findByTokenHash(tokenHash): Promise<StoredSession | null> {
      const row = rows.get(tokenHash);
      if (row === undefined) return null;
      return {
        id: row.id,
        subject: row.subject,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
      };
    },
    async revokeByTokenHash(tokenHash, at) {
      const row = rows.get(tokenHash);
      if (row !== undefined && row.revokedAt === null) row.revokedAt = at;
    },
    async revokeAllForSubject(subject, at) {
      let count = 0;
      for (const row of rows.values()) {
        if (row.subject === subject && row.revokedAt === null) {
          row.revokedAt = at;
          count += 1;
        }
      }
      return count;
    },
  };
  return { store, rows };
}

function setup(lifetimeMs = 24 * HOUR) {
  const { store, rows } = fakeStore();
  let now = START;
  let counter = 0;
  const tokens: SessionTokens = {
    generate() {
      counter += 1;
      return { token: `token-${counter}`, tokenHash: `hash:token-${counter}` };
    },
    hash: (token) => `hash:${token}`,
  };
  const sessions = makeSessions({
    store,
    tokens,
    clock: { now: () => now },
    ids: { next: () => `id-${counter}` },
    expiryFor: expiresAfter(lifetimeMs),
  });
  return {
    sessions,
    rows,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

describe("makeSessions", () => {
  describe("issue", () => {
    it("returns the token and its expiry, and stores only the hash", async () => {
      const { sessions, rows } = setup();
      const issued = await sessions.issue("sub-1");
      expect(issued).toEqual({
        token: "token-1",
        expiresAt: new Date(START.getTime() + 24 * HOUR),
      });
      const stored = [...rows.values()];
      expect(stored).toHaveLength(1);
      expect(JSON.stringify(stored)).not.toContain('"token-1"');
      expect(stored[0]).toMatchObject({
        tokenHash: "hash:token-1",
        subject: "sub-1",
        createdAt: START,
      });
    });

    it("throws on a blank subject, because that is a bug in the caller", async () => {
      await expect(setup().sessions.issue("  ")).rejects.toThrow(/subject/i);
    });
  });

  describe("authenticate", () => {
    it("accepts a live session and names its owner", async () => {
      const { sessions } = setup();
      const { token } = await sessions.issue("sub-1");
      const result = await sessions.authenticate(token);
      expect(result).toEqual({ ok: true, value: { sessionId: "id-1", subject: "sub-1" } });
    });

    it("rejects the stored hash used as a token, so a database dump is useless", async () => {
      const { sessions, rows } = setup();
      await sessions.issue("sub-1");
      const dumpedHash = [...rows.values()][0]?.tokenHash ?? "";
      const result = await sessions.authenticate(dumpedHash);
      expect(result.ok).toBe(false);
    });

    it("rejects a token that was never issued", async () => {
      const result = await setup().sessions.authenticate("nope");
      expect(result).toEqual({
        ok: false,
        error: { kind: "unauthenticated", message: "Sign in required" },
      });
    });

    it.each([
      ["empty", ""],
      ["too long", "a".repeat(513)],
    ])("rejects a token that is %s without a lookup", async (_name, token) => {
      expect((await setup().sessions.authenticate(token)).ok).toBe(false);
    });

    it("rejects an expired session", async () => {
      const { sessions, advance } = setup();
      const { token } = await sessions.issue("sub-1");
      advance(24 * HOUR);
      expect((await sessions.authenticate(token)).ok).toBe(false);
    });

    it("rejects a revoked session on the next request", async () => {
      const { sessions } = setup();
      const { token } = await sessions.issue("sub-1");
      await sessions.signOut(token);
      expect((await sessions.authenticate(token)).ok).toBe(false);
    });

    it("gives the same answer for unknown, expired and revoked tokens", async () => {
      const { sessions, advance } = setup();
      const expired = await sessions.issue("sub-1");
      advance(25 * HOUR);
      const revoked = await sessions.issue("sub-1");
      await sessions.signOut(revoked.token);
      const answers = await Promise.all([
        sessions.authenticate("unknown"),
        sessions.authenticate(expired.token),
        sessions.authenticate(revoked.token),
      ]);
      expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    });
  });

  describe("signOut", () => {
    it("ends only that session", async () => {
      const { sessions } = setup();
      const phone = await sessions.issue("sub-1");
      const tablet = await sessions.issue("sub-1");
      await sessions.signOut(phone.token);
      expect((await sessions.authenticate(phone.token)).ok).toBe(false);
      expect((await sessions.authenticate(tablet.token)).ok).toBe(true);
    });

    it("is quiet for an unknown, empty or already revoked token", async () => {
      const { sessions } = setup();
      const { token } = await sessions.issue("sub-1");
      await sessions.signOut(token);
      await expect(sessions.signOut(token)).resolves.toBeUndefined();
      await expect(sessions.signOut("unknown")).resolves.toBeUndefined();
      await expect(sessions.signOut("")).resolves.toBeUndefined();
    });
  });

  describe("revokeAll", () => {
    it("revokes every session of one person and no one else", async () => {
      const { sessions } = setup();
      const a1 = await sessions.issue("sub-1");
      const a2 = await sessions.issue("sub-1");
      const b = await sessions.issue("sub-2");
      expect(await sessions.revokeAll("sub-1")).toBe(2);
      expect((await sessions.authenticate(a1.token)).ok).toBe(false);
      expect((await sessions.authenticate(a2.token)).ok).toBe(false);
      expect((await sessions.authenticate(b.token)).ok).toBe(true);
    });

    it("reports zero when there is nothing to revoke", async () => {
      expect(await setup().sessions.revokeAll("sub-9")).toBe(0);
    });
  });
});
