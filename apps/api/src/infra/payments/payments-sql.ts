import type { PaymentStore, StoredPayment } from "../../app/ports";
import type { Allocation, PaymentMethod } from "../../domain/payment";
import type { SqlExecutor } from "../db/sql-executor";

/** Dates leave Postgres as plain text, so no time zone of this process can shift a calendar day. */
const DATE = "'YYYY-MM-DD'";
const UTC_TIMESTAMP = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

interface PaymentRow {
  id: string;
  member_id: string;
  amount: number;
  method: PaymentMethod;
  paid_on: string;
  submitted_at: string;
  proof_link: string | null;
  recorded_by: string;
  is_void: boolean;
  void_reason: string | null;
}

/** What a payment allocated, oldest invoice first. Void payments keep theirs, they just stop counting. */
export async function paymentAllocations(
  executor: SqlExecutor,
  tenantId: string,
  paymentId: string,
): Promise<readonly Allocation[]> {
  const found = (await executor.query(
    `SELECT a.invoice_id, a.amount
       FROM payment_allocations a
       JOIN invoices i ON i.tenant_id = a.tenant_id AND i.id = a.invoice_id
      WHERE a.tenant_id = $1 AND a.payment_id = $2
      ORDER BY i.period_start, i.id`,
    [tenantId, paymentId],
  )) as { invoice_id: string; amount: number }[];
  return found.map((a) => ({ invoiceId: a.invoice_id, amount: a.amount }));
}

/**
 * The payments of one tenant. Every statement names the tenant, and row level security checks it
 * again. `executor` must run inside the tenant transaction, so a payment and its allocations
 * commit together or not at all.
 */
export function makePaymentStore(executor: SqlExecutor, tenantId: string): PaymentStore {
  async function rows<Row>(sql: string, params: unknown[]): Promise<Row[]> {
    return (await executor.query(sql, params)) as Row[];
  }

  return {
    async findByRequestId(clientRequestId) {
      const [row] = await rows<PaymentRow>(
        `SELECT id, member_id, amount, method, proof_link, recorded_by, is_void, void_reason,
                to_char(paid_on, ${DATE}) AS paid_on,
                to_char(submitted_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP}) AS submitted_at
           FROM payments WHERE tenant_id = $1 AND client_request_id = $2`,
        [tenantId, clientRequestId],
      );
      if (row === undefined) return null;
      const allocations = await paymentAllocations(executor, tenantId, row.id);
      return {
        id: row.id,
        memberId: row.member_id,
        amount: row.amount,
        method: row.method,
        paidOn: row.paid_on,
        submittedAt: row.submitted_at,
        proofLink: row.proof_link,
        recordedBy: row.recorded_by,
        isVoid: row.is_void,
        voidReason: row.void_reason,
        allocations,
      } satisfies StoredPayment;
    },

    async unpaidInvoices(memberId) {
      const found = await rows<{ id: string; amount_due: number }>(
        `SELECT id, amount_due FROM (
           SELECT i.id, i.period_start,
                  i.total - COALESCE(SUM(a.amount) FILTER (WHERE NOT p.is_void), 0) AS amount_due
             FROM invoices i
             LEFT JOIN payment_allocations a ON a.tenant_id = i.tenant_id AND a.invoice_id = i.id
             LEFT JOIN payments p ON p.tenant_id = a.tenant_id AND p.id = a.payment_id
            WHERE i.tenant_id = $1 AND i.member_id = $2 AND NOT i.is_void
            GROUP BY i.id
         ) owed
          WHERE amount_due > 0
          ORDER BY period_start, id`,
        [tenantId, memberId],
      );
      return found.map((row) => ({ invoiceId: row.id, amountDue: Number(row.amount_due) }));
    },

    async ledger(memberId) {
      const found = await rows<{
        id: string;
        period_start: string;
        period_end: string;
        due_date: string;
        amount_due: number;
      }>(
        `SELECT i.id,
                to_char(i.period_start, ${DATE}) AS period_start,
                to_char(i.period_end, ${DATE}) AS period_end,
                to_char(i.due_date, ${DATE}) AS due_date,
                i.total - COALESCE(SUM(a.amount) FILTER (WHERE NOT p.is_void), 0) AS amount_due
           FROM invoices i
           LEFT JOIN payment_allocations a ON a.tenant_id = i.tenant_id AND a.invoice_id = i.id
           LEFT JOIN payments p ON p.tenant_id = a.tenant_id AND p.id = a.payment_id
          WHERE i.tenant_id = $1 AND i.member_id = $2 AND NOT i.is_void
          GROUP BY i.id
          ORDER BY i.period_start, i.id`,
        [tenantId, memberId],
      );
      return found.map((row) => ({
        invoiceId: row.id,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        dueDate: row.due_date,
        amountDue: Number(row.amount_due),
      }));
    },

    async insert(row) {
      const [created] = await rows<{ id: string; submitted_at: string }>(
        `INSERT INTO payments
           (tenant_id, member_id, amount, method, paid_on, proof_link, recorded_by, client_request_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (tenant_id, client_request_id) DO NOTHING
         RETURNING id, to_char(submitted_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP}) AS submitted_at`,
        [
          tenantId,
          row.memberId,
          row.amount,
          row.method,
          row.paidOn,
          row.proofLink,
          row.recordedBy,
          row.clientRequestId,
        ],
      );
      return created === undefined ? null : { id: created.id, submittedAt: created.submitted_at };
    },

    async insertAllocations(paymentId, allocations) {
      if (allocations.length === 0) return;
      await executor.query(
        `INSERT INTO payment_allocations (tenant_id, payment_id, invoice_id, amount)
         SELECT $1, $2, invoice_id, amount
           FROM unnest($3::uuid[], $4::int[]) AS allocation (invoice_id, amount)`,
        [
          tenantId,
          paymentId,
          allocations.map((a) => a.invoiceId),
          allocations.map((a) => a.amount),
        ],
      );
    },
  };
}
