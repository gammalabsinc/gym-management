import type { DiscountStore, StoredDiscount } from "../../app/ports";
import type { SqlExecutor } from "../db/sql-executor";

const DATE = "'YYYY-MM-DD'";

interface Row {
  id: string;
  member_id: string;
  kind: StoredDiscount["kind"];
  amount: number;
  is_recurring: boolean;
  starts_on: string;
  ends_on: string | null;
  is_active: boolean;
  consumed_invoice_id: string | null;
}

function toDiscount(row: Row): StoredDiscount {
  return {
    id: row.id,
    memberId: row.member_id,
    kind: row.kind,
    amount: row.amount,
    isRecurring: row.is_recurring,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    isActive: row.is_active,
    consumedInvoiceId: row.consumed_invoice_id,
  };
}

/**
 * The discounts of one tenant. Every statement names the tenant, and row level security checks it
 * again. `executor` must run inside the tenant transaction.
 */
export function makeDiscountStore(executor: SqlExecutor, tenantId: string): DiscountStore {
  async function rows<R>(sql: string, params: unknown[]): Promise<R[]> {
    return (await executor.query(sql, params)) as R[];
  }

  return {
    async find(discountId) {
      const [row] = await rows<Row>(
        `SELECT id, member_id, kind, amount, is_recurring, to_char(starts_on, ${DATE}) AS starts_on,
                to_char(ends_on, ${DATE}) AS ends_on, is_active, consumed_invoice_id
           FROM member_discounts WHERE tenant_id = $1 AND id = $2`,
        [tenantId, discountId],
      );
      return row === undefined ? null : toDiscount(row);
    },

    async insertManual(row) {
      const [created] = await rows<{ id: string }>(
        `INSERT INTO member_discounts
           (tenant_id, member_id, kind, amount, is_recurring, reason, starts_on, created_by)
         VALUES ($1, $2, 'manual', $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          tenantId,
          row.memberId,
          row.amount,
          row.isRecurring,
          row.reason,
          row.startsOn,
          row.createdBy,
        ],
      );
      if (created === undefined) throw new Error("The discount row was not returned");
      return created.id;
    },

    async end(discountId, endsOn) {
      const changed = await rows<{ id: string }>(
        `UPDATE member_discounts SET ends_on = $3::date, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND is_active
            AND (ends_on IS NULL OR ends_on > $3::date)
          RETURNING id`,
        [tenantId, discountId, endsOn],
      );
      return changed.length > 0;
    },
  };
}
