import type { MigrationInterface, QueryRunner } from "typeorm";
import { APP_ROLE } from "../roles";

/**
 * Login sessions. The table holds the SHA-256 of each token, never the token, so a copy of the
 * database yields nothing that can be sent as a bearer header.
 *
 * There is no tenant_id: a session belongs to a Google account, which can hold roles in several
 * gyms, and the token is looked up before any gym is chosen. The app role may add sessions and
 * set revoked_at, and nothing else, so even a stolen app credential cannot extend a session
 * or rewrite whose it is.
 */
export class Sessions1700000004000 implements MigrationInterface {
  name = "Sessions1700000004000";

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE sessions (
        id uuid PRIMARY KEY,
        token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
        auth_subject text NOT NULL CHECK (auth_subject <> ''),
        created_at timestamptz NOT NULL,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        CHECK (expires_at > created_at)
      )`);
    await runner.query("CREATE INDEX sessions_auth_subject_idx ON sessions (auth_subject)");
    await runner.query(`REVOKE ALL ON sessions FROM ${APP_ROLE}`);
    await runner.query(`GRANT SELECT, INSERT ON sessions TO ${APP_ROLE}`);
    await runner.query(`GRANT UPDATE (revoked_at) ON sessions TO ${APP_ROLE}`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query("DROP TABLE sessions");
  }
}
