import type { WhoAmIStore } from "../../app/ports";
import { rolesFromRows } from "../../domain/gym-picker";
import type { SqlExecutor } from "../db/sql-executor";

interface MeRow {
  id: string;
  name: string | null;
  email: string;
  roles: string[];
  member_id: string | null;
}

/**
 * The caller's own user row with their roles and the member record they own, if any. The
 * statements name the tenant and row level security checks it again, so a user id from another
 * gym finds nothing. A switched off user is not found.
 */
export function makeWhoAmIStore(executor: SqlExecutor, tenantId: string): WhoAmIStore {
  return {
    async find(userId) {
      const [row] = (await executor.query(
        `SELECT u.id, u.name, u.email,
                COALESCE(array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles,
                (SELECT m.id FROM members m WHERE m.tenant_id = u.tenant_id AND m.user_id = u.id) AS member_id
           FROM users u
           LEFT JOIN user_roles r ON r.tenant_id = u.tenant_id AND r.user_id = u.id
          WHERE u.tenant_id = $1 AND u.id = $2 AND u.is_active
          GROUP BY u.id`,
        [tenantId, userId],
      )) as MeRow[];
      if (row === undefined) return null;
      return {
        userId: row.id,
        name: row.name,
        email: row.email,
        roles: rolesFromRows(row.roles),
        memberId: row.member_id,
      };
    },
  };
}
