import type { GymPickerStore } from "../../app/ports";
import { rolesFromRows } from "../../domain/gym-picker";
import { brandingFromJson } from "../../domain/tenant";
import type { SqlExecutor } from "../db/sql-executor";

interface GymRow {
  name: string;
  subdomain: string;
  branding: unknown;
  roles: string[];
}

/**
 * The gym as the picker shows it, for one user of one tenant. It reads the name, the subdomain
 * and the logo of the gym and the user's own roles, and no other column of the tenant row. The
 * join on the user row keeps a switched off user out, and the tenant filter a switched off gym.
 * `executor` must run inside the tenant transaction, so row level security checks the roles too.
 */
export function makeGymPickerStore(executor: SqlExecutor, tenantId: string): GymPickerStore {
  return {
    async find(userId) {
      const [row] = (await executor.query(
        `SELECT t.name, t.subdomain, t.branding, array_agg(r.role ORDER BY r.role) AS roles
           FROM tenants t
           JOIN users u ON u.tenant_id = t.id AND u.id = $2 AND u.is_active
           JOIN user_roles r ON r.tenant_id = u.tenant_id AND r.user_id = u.id
          WHERE t.id = $1 AND t.is_active
          GROUP BY t.id`,
        [tenantId, userId],
      )) as GymRow[];
      if (row === undefined) return null;
      return {
        tenantId,
        name: row.name,
        subdomain: row.subdomain,
        logoUrl: brandingFromJson(row.branding).logoUrl,
        roles: rolesFromRows(row.roles),
      };
    },
  };
}
