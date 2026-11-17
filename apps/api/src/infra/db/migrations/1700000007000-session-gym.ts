import type { MigrationInterface, QueryRunner } from "typeorm";
import { APP_ROLE } from "../roles";

/**
 * The gym a session is bound to. It is null for an identity session, which knows who the person
 * is and has not picked a gym yet. The column is called gym_id and not tenant_id on purpose: the
 * session table is not tenant scoped, so it must not look like a tenant table to the row level
 * security guard.
 *
 * The app role may set this one column and still cannot change whose session it is or extend it.
 * The server checks the person holds a role in the gym before it sets the column.
 */
export class SessionGym1700000007000 implements MigrationInterface {
  name = "SessionGym1700000007000";

  async up(runner: QueryRunner): Promise<void> {
    await runner.query("ALTER TABLE sessions ADD COLUMN gym_id uuid REFERENCES tenants (id)");
    await runner.query(`GRANT UPDATE (gym_id) ON sessions TO ${APP_ROLE}`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query("ALTER TABLE sessions DROP COLUMN gym_id");
  }
}
