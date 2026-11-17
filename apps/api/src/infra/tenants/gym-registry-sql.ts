import type { GymRegistry } from "../../app/ports";
import type { SqlExecutor } from "../db/sql-executor";

/** Reads only whether a gym is there and switched on, and nothing else about it. */
export function makeGymRegistry(executor: SqlExecutor): GymRegistry {
  return {
    async isActive(gymId) {
      const rows = (await executor.query("SELECT 1 FROM tenants WHERE id = $1 AND is_active", [
        gymId,
      ])) as unknown[];
      return rows.length > 0;
    },
  };
}
