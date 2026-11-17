import type { ReferralStore } from "../../app/ports";
import type { SqlExecutor } from "../db/sql-executor";

/**
 * The referral discounts of one tenant. Every statement names the tenant, and row level security
 * checks it again. `executor` must run inside the tenant transaction.
 */
export function makeReferralStore(executor: SqlExecutor, tenantId: string): ReferralStore {
  async function rows<Row>(sql: string, params: unknown[]): Promise<Row[]> {
    return (await executor.query(sql, params)) as Row[];
  }

  return {
    async referrerOf(memberId) {
      const [row] = await rows<{ referred_by: string | null }>(
        "SELECT referred_by FROM members WHERE tenant_id = $1 AND id = $2",
        [tenantId, memberId],
      );
      return row === undefined ? undefined : row.referred_by;
    },

    async exists(memberId, referrerId) {
      const found = await rows<unknown>(
        `SELECT 1 FROM member_discounts
          WHERE tenant_id = $1 AND kind = 'referral'
            AND ((member_id = $2 AND source_member_id = $3)
              OR (member_id = $3 AND source_member_id = $2))`,
        [tenantId, memberId, referrerId],
      );
      return found.length > 0;
    },

    async insert(row) {
      const [created] = await rows<{ id: string }>(
        `INSERT INTO member_discounts
           (tenant_id, member_id, kind, referral_side, source_member_id, amount, is_recurring,
            starts_on, created_by)
         VALUES ($1, $2, 'referral', $3, $4, $5, $6, $7, $8)
         ON CONFLICT (tenant_id, member_id, source_member_id, referral_side) DO NOTHING
         RETURNING id`,
        [
          tenantId,
          row.memberId,
          row.side,
          row.sourceMemberId,
          row.amount,
          row.isRecurring,
          row.startsOn,
          row.createdBy,
        ],
      );
      return created === undefined ? null : created.id;
    },
  };
}
