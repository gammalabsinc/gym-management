import type { BackfillStore } from "../../app/ports";
import type { SqlExecutor } from "../db/sql-executor";

/**
 * The discounts of the one off backfill, written straight into the table. Nothing here reads the
 * gym's referral defaults. A discount that matches an existing one of the same member in kind,
 * side, source, amount, recurrence and start day is left alone, which makes a rerun add nothing.
 * Every statement names the tenant, and row level security checks it again.
 */
export function makeBackfillStore(executor: SqlExecutor, tenantId: string): BackfillStore {
  return {
    async insertDiscountIfAbsent(row) {
      const created = (await executor.query(
        `INSERT INTO member_discounts
           (tenant_id, member_id, kind, referral_side, source_member_id, amount, is_recurring,
            reason, starts_on, ends_on, created_by)
         SELECT $1::uuid, $2::uuid, $3::text, $4::text, $5::uuid, $6::int, $7::boolean,
                $8::text, $9::date, $10::date, $11::uuid
          WHERE NOT EXISTS (
            SELECT 1 FROM member_discounts d
             WHERE d.tenant_id = $1::uuid AND d.member_id = $2::uuid AND d.kind = $3::text
               AND d.referral_side IS NOT DISTINCT FROM $4::text
               AND d.source_member_id IS NOT DISTINCT FROM $5::uuid
               AND d.amount = $6::int AND d.is_recurring = $7::boolean
               AND d.starts_on = $9::date
          )
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          tenantId,
          row.memberId,
          row.kind,
          row.referralSide,
          row.sourceMemberId,
          row.amount,
          row.isRecurring,
          row.reason,
          row.startsOn,
          row.endsOn,
          row.createdBy,
        ],
      )) as { id: string }[];
      return created[0]?.id ?? null;
    },
  };
}
