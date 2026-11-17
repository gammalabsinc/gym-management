import type { MemberRoster } from "../../app/ports";
import type { SqlExecutor } from "../db/sql-executor";

/**
 * The members of one tenant whose current period is active. A paused or cancelled member is not on
 * it. `executor` must run inside the tenant transaction, and the statement names the tenant too.
 */
export function makeMemberRoster(executor: SqlExecutor, tenantId: string): MemberRoster {
  return {
    async activeMemberIds() {
      const rows = (await executor.query(
        `SELECT m.id
           FROM members m
           JOIN membership_periods p
             ON p.tenant_id = m.tenant_id AND p.member_id = m.id
            AND p.valid_to IS NULL AND p.status = 'active'
          WHERE m.tenant_id = $1
          ORDER BY m.id`,
        [tenantId],
      )) as { id: string }[];
      return rows.map((row) => row.id);
    },
  };
}
