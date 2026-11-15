import type { MigrationInterface, QueryRunner } from "typeorm";
import { APP_ROLE } from "../roles";

/**
 * The audit trail from the Data Model. Rows are only ever added. The app role is granted insert
 * and select and nothing else, so an UPDATE, DELETE or TRUNCATE fails at the database no matter
 * what the code does. The default privileges from the first migration would have granted more,
 * which is why the grants are reset here instead of trusted.
 */
export class AuditEvents1700000002000 implements MigrationInterface {
  name = "AuditEvents1700000002000";

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE audit_events (
        tenant_id uuid NOT NULL REFERENCES tenants (id),
        id uuid NOT NULL,
        occurred_at timestamptz NOT NULL,
        actor_user_id uuid,
        action text NOT NULL CHECK (action <> ''),
        entity_type text NOT NULL CHECK (entity_type <> ''),
        entity_id uuid NOT NULL,
        before jsonb,
        after jsonb,
        request_id text NOT NULL CHECK (request_id <> ''),
        PRIMARY KEY (tenant_id, id),
        FOREIGN KEY (tenant_id, actor_user_id) REFERENCES users (tenant_id, id)
      )`);
    await runner.query(
      "CREATE INDEX audit_events_entity_idx ON audit_events (tenant_id, entity_type, entity_id, occurred_at)",
    );
    await runner.query(`REVOKE ALL ON audit_events FROM ${APP_ROLE}`);
    await runner.query(`GRANT SELECT, INSERT ON audit_events TO ${APP_ROLE}`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query("DROP TABLE audit_events");
  }
}
