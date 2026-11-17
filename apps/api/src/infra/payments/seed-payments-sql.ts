import type { SeedPaymentStore } from "../../app/ports";
import type { SqlExecutor } from "../db/sql-executor";

/**
 * The payments of one tenant, as far as the dev seed needs them. Every statement names the
 * tenant, and row level security checks it again. `executor` must run inside the tenant
 * transaction, so the payment and its allocation commit together or not at all.
 */
export function makeSeedPaymentStore(executor: SqlExecutor, tenantId: string): SeedPaymentStore {
  async function rows<Row>(sql: string, params: unknown[]): Promise<Row[]> {
    return (await executor.query(sql, params)) as Row[];
  }

  return {
    async insertPaid(row) {
      const [payment] = await rows<{ id: string }>(
        `INSERT INTO payments
           (tenant_id, member_id, amount, method, paid_on, recorded_by, client_request_id)
         VALUES ($1, $2, $3, 'cash', $4, $5, $6)
         RETURNING id`,
        [tenantId, row.memberId, row.amount, row.paidOn, row.recordedBy, row.clientRequestId],
      );
      if (payment === undefined) throw new Error("The payment was not written");
      await executor.query(
        `INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, amount)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, payment.id, row.invoiceId, row.amount],
      );
      return payment.id;
    },
  };
}
