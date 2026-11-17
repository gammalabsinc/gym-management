import type { TenantRegistry } from "../../app/ports";
import type { SqlExecutor } from "../db/sql-executor";

/** The gyms that are switched on. The tenants table has no row level security, the gym is the row. */
export function makeTenantRegistry(executor: SqlExecutor): TenantRegistry {
  return {
    async activeTenantIds() {
      const rows = (await executor.query(
        "SELECT id FROM tenants WHERE is_active ORDER BY id",
        [],
      )) as { id: string }[];
      return rows.map((row) => row.id);
    },
  };
}
