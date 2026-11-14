import type { MigrationInterface, QueryRunner } from "typeorm";
import { APP_ROLE, MIGRATOR_ROLE } from "../roles";

/**
 * Every table and sequence the migrator creates from now on is readable and writable by the
 * app role, and nothing else is. DDL stays with the migrator.
 */
export class GrantAppPrivileges1700000000000 implements MigrationInterface {
  name = "GrantAppPrivileges1700000000000";

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATOR_ROLE} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}`,
    );
    await runner.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATOR_ROLE} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE}`,
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATOR_ROLE} IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${APP_ROLE}`,
    );
    await runner.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${MIGRATOR_ROLE} IN SCHEMA public REVOKE ALL ON TABLES FROM ${APP_ROLE}`,
    );
  }
}
