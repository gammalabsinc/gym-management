import type { MigrationInterface, QueryRunner } from "typeorm";
import { TENANT_SETTING } from "../tenant-tx";

/** Tables that carry a tenant_id. A new tenant table adds itself here in its own migration. */
const TENANT_TABLES = ["users", "user_roles", "audit_events"] as const;

const POLICY = "tenant_isolation";

/** No tenant set, or an empty one, gives NULL, and a comparison with NULL matches no row. */
const CURRENT_TENANT = `nullif(current_setting('${TENANT_SETTING}', true), '')::uuid`;

/**
 * A tenant sees and writes only its own rows. FORCE applies the policy to the table owner as well,
 * so the migrator role cannot read tenant data by accident either.
 */
export class RowLevelSecurity1700000003000 implements MigrationInterface {
  name = "RowLevelSecurity1700000003000";

  async up(runner: QueryRunner): Promise<void> {
    for (const table of TENANT_TABLES) {
      await runner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      await runner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      await runner.query(
        `CREATE POLICY ${POLICY} ON ${table} USING (tenant_id = ${CURRENT_TENANT}) WITH CHECK (tenant_id = ${CURRENT_TENANT})`,
      );
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    for (const table of [...TENANT_TABLES].reverse()) {
      await runner.query(`DROP POLICY ${POLICY} ON ${table}`);
      await runner.query(`ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`);
      await runner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    }
  }
}
