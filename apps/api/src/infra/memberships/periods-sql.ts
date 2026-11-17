import type { CurrentPeriod, PeriodStore } from "../../app/ports";
import type { SqlExecutor } from "../db/sql-executor";

interface PeriodRow {
  id: string;
  plan_id: string;
  status: CurrentPeriod["status"];
  valid_from: string;
}

/**
 * The membership periods of one tenant. Every statement names the tenant, and row level security
 * checks it again. The no overlap constraint and the one current row index are the final judges.
 */
export function makePeriodStore(executor: SqlExecutor, tenantId: string): PeriodStore {
  return {
    async lockCurrent(memberId) {
      // Two statements on purpose. Under READ COMMITTED a statement that waits for the lock still
      // reads its old snapshot, so the period is read only after the lock is held.
      const locked = (await executor.query(
        "SELECT id FROM members WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
        [tenantId, memberId],
      )) as unknown[];
      if (locked.length === 0) return null;
      const [row] = (await executor.query(
        `SELECT id, plan_id, status, to_char(valid_from, 'YYYY-MM-DD') AS valid_from
           FROM membership_periods
          WHERE tenant_id = $1 AND member_id = $2 AND valid_to IS NULL`,
        [tenantId, memberId],
      )) as PeriodRow[];
      if (row === undefined) throw new Error("A member has no current membership period");
      return { id: row.id, planId: row.plan_id, status: row.status, validFrom: row.valid_from };
    },

    async close(periodId, validTo) {
      await executor.query(
        "UPDATE membership_periods SET valid_to = $3 WHERE tenant_id = $1 AND id = $2 AND valid_to IS NULL",
        [tenantId, periodId, validTo],
      );
    },

    async open(period) {
      await executor.query(
        `INSERT INTO membership_periods
           (tenant_id, member_id, plan_id, status, valid_from, reason, changed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          tenantId,
          period.memberId,
          period.planId,
          period.status,
          period.validFrom,
          period.reason,
          period.changedBy,
        ],
      );
    },
  };
}
