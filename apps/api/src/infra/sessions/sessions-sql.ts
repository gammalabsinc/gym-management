import type { NewSession, SessionStore, StoredSession } from "../../app/ports";
import type { SqlExecutor } from "../db/sql-executor";

interface SessionRow {
  id: string;
  auth_subject: string;
  expires_at: Date;
  revoked_at: Date | null;
}

function toSession(row: SessionRow): StoredSession {
  return {
    id: row.id,
    subject: row.auth_subject,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

/**
 * Sessions are not tenant scoped: the token is looked up before any gym is chosen, and one
 * person has one session across every gym. The table has no tenant_id for that reason.
 */
export function makeSessionStore(executor: SqlExecutor): SessionStore {
  return {
    async insert(session: NewSession) {
      await executor.query(
        `INSERT INTO sessions (id, token_hash, auth_subject, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [session.id, session.tokenHash, session.subject, session.createdAt, session.expiresAt],
      );
    },

    async findByTokenHash(tokenHash) {
      const rows = (await executor.query(
        "SELECT id, auth_subject, expires_at, revoked_at FROM sessions WHERE token_hash = $1",
        [tokenHash],
      )) as SessionRow[];
      const row = rows[0];
      return row === undefined ? null : toSession(row);
    },

    async revokeByTokenHash(tokenHash, at) {
      await executor.query(
        "UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL",
        [tokenHash, at],
      );
    },

    async revokeAllForSubject(subject, at) {
      const rows = (await executor.query(
        `UPDATE sessions SET revoked_at = $2
         WHERE auth_subject = $1 AND revoked_at IS NULL
         RETURNING id`,
        [subject, at],
      )) as unknown[];
      return rows.length;
    },
  };
}
