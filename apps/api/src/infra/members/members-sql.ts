import type { MemberStore } from "../../app/ports";
import type { SqlExecutor } from "../db/sql-executor";

/**
 * The members of one tenant. Every statement names the tenant, and row level security checks it
 * again. `executor` must run inside the tenant transaction.
 *
 * The unique indexes on member_no and barcode are table wide, so a code taken by another gym is a
 * conflict here too. ON CONFLICT DO NOTHING sees the index and not the rows, so it never reveals
 * which gym holds the code.
 */
export function makeMemberStore(executor: SqlExecutor, tenantId: string): MemberStore {
  async function rows<Row>(sql: string, params: unknown[]): Promise<Row[]> {
    return (await executor.query(sql, params)) as Row[];
  }

  return {
    async findIdByUser(userId) {
      const [row] = await rows<{ id: string }>(
        "SELECT id FROM members WHERE tenant_id = $1 AND user_id = $2",
        [tenantId, userId],
      );
      return row === undefined ? null : row.id;
    },

    async exists(memberId) {
      const found = await rows<unknown>("SELECT 1 FROM members WHERE tenant_id = $1 AND id = $2", [
        tenantId,
        memberId,
      ]);
      return found.length > 0;
    },

    async insertIfAbsent(row) {
      const [created] = await rows<{ id: string }>(
        `INSERT INTO members (tenant_id, user_id, member_no, barcode, billing_day, referred_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [tenantId, row.userId, row.memberNo, row.barcode, row.billingDay, row.referredBy],
      );
      return created === undefined ? null : created.id;
    },

    async openPeriod(period) {
      await executor.query(
        `INSERT INTO membership_periods
           (tenant_id, member_id, plan_id, status, valid_from, changed_by)
         VALUES ($1, $2, $3, 'active', $4, $5)`,
        [tenantId, period.memberId, period.planId, period.validFrom, period.changedBy],
      );
    },
  };
}
