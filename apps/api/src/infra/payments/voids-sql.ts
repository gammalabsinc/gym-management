import type { VoidStore } from "../../app/ports";
import type { SqlExecutor } from "../db/sql-executor";
import { paymentAllocations } from "./payments-sql";

const DATE = "'YYYY-MM-DD'";

const VOID_SET = "is_void = true, void_reason = $3, voided_by = $4, voided_at = $5";

/**
 * Voids in one tenant. Every statement names the tenant, and row level security checks it again.
 * A void is the only change a money row accepts, and the database also refuses a second void and
 * the void of an invoice that has counted allocations. `executor` must run inside the tenant
 * transaction, so a void and the credit it frees commit together.
 */
export function makeVoidStore(executor: SqlExecutor, tenantId: string): VoidStore {
  async function rows<Row>(sql: string, params: unknown[]): Promise<Row[]> {
    return (await executor.query(sql, params)) as Row[];
  }

  return {
    async findPayment(paymentId) {
      const [row] = await rows<{
        id: string;
        member_id: string;
        amount: number;
        is_void: boolean;
      }>("SELECT id, member_id, amount, is_void FROM payments WHERE tenant_id = $1 AND id = $2", [
        tenantId,
        paymentId,
      ]);
      if (row === undefined) return null;
      return {
        id: row.id,
        memberId: row.member_id,
        amount: row.amount,
        isVoid: row.is_void,
        allocations: await paymentAllocations(executor, tenantId, row.id),
      };
    },

    async findInvoice(invoiceId) {
      const [row] = await rows<{
        id: string;
        member_id: string;
        is_void: boolean;
        period_start: string;
        total: number;
        counted: number;
      }>(
        `SELECT i.id, i.member_id, i.is_void, i.total,
                to_char(i.period_start, ${DATE}) AS period_start,
                COALESCE((
                  SELECT SUM(a.amount) FROM payment_allocations a
                    JOIN payments p ON p.tenant_id = a.tenant_id AND p.id = a.payment_id
                   WHERE a.tenant_id = i.tenant_id AND a.invoice_id = i.id AND NOT p.is_void
                ), 0)::int AS counted
           FROM invoices i WHERE i.tenant_id = $1 AND i.id = $2`,
        [tenantId, invoiceId],
      );
      return row === undefined
        ? null
        : {
            id: row.id,
            memberId: row.member_id,
            isVoid: row.is_void,
            periodStart: row.period_start,
            total: row.total,
            counted: row.counted,
          };
    },

    async voidPayment(paymentId, details) {
      const changed = await rows<{ id: string }>(
        `UPDATE payments SET ${VOID_SET} WHERE tenant_id = $1 AND id = $2 AND NOT is_void RETURNING id`,
        [tenantId, paymentId, details.reason, details.voidedBy, details.voidedAt],
      );
      return changed.length > 0;
    },

    async voidInvoice(invoiceId, details) {
      const changed = await rows<{ id: string }>(
        `UPDATE invoices SET ${VOID_SET} WHERE tenant_id = $1 AND id = $2 AND NOT is_void RETURNING id`,
        [tenantId, invoiceId, details.reason, details.voidedBy, details.voidedAt],
      );
      return changed.length > 0;
    },

    async spareCredits(memberId) {
      const found = await rows<{ id: string; remainder: number }>(
        `SELECT p.id, (p.amount - COALESCE(SUM(a.amount), 0))::int AS remainder
           FROM payments p
           LEFT JOIN payment_allocations a ON a.tenant_id = p.tenant_id AND a.payment_id = p.id
          WHERE p.tenant_id = $1 AND p.member_id = $2 AND NOT p.is_void
          GROUP BY p.id
         HAVING p.amount - COALESCE(SUM(a.amount), 0) > 0
          ORDER BY p.submitted_at, p.id`,
        [tenantId, memberId],
      );
      return found.map((row) => ({ paymentId: row.id, remainder: row.remainder }));
    },
  };
}
