import type {
  LedgerDiscountRow,
  LedgerInvoiceLine,
  LedgerInvoiceRow,
  LedgerPageRequest,
  LedgerPaymentRow,
  LedgerPeriodRow,
  LedgerStore,
} from "../../app/ports";
import type { LedgerPosition } from "../../domain/member-ledger";
import type { SqlExecutor } from "../db/sql-executor";
import { COUNTED_ALLOCATIONS_SQL } from "../members/member-queries-sql";

const DATE = "'YYYY-MM-DD'";
const UTC_TIMESTAMP = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

/** Keyset paging, newest first, on a date column and the row id. Both parameters are null on the first page. */
function afterClause(dateColumn: string, date: string, id: string, idColumn: string): string {
  return `(${date}::date IS NULL OR (${dateColumn}, ${idColumn}) < (${date}::date, ${id}::uuid))`;
}

function positionParams(after: LedgerPosition | null): [string | null, string | null] {
  return after === null ? [null, null] : [after.date, after.id];
}

interface InvoiceRow {
  id: string;
  period_start: string;
  period_end: string;
  due_date: string;
  total: number;
  amount_due: number;
  is_void: boolean;
  void_reason: string | null;
}

interface LineRow {
  invoice_id: string;
  line_type: LedgerInvoiceLine["type"];
  description: string;
  amount: number;
}

interface PaymentRow {
  id: string;
  amount: number;
  method: LedgerPaymentRow["method"];
  paid_on: string;
  recorded_at: string;
  recorded_by_name: string | null;
  is_void: boolean;
  void_reason: string | null;
}

interface DiscountRow {
  id: string;
  kind: LedgerDiscountRow["kind"];
  referral_side: LedgerDiscountRow["referralSide"];
  source_member_name: string | null;
  amount: number;
  is_recurring: boolean;
  reason: string | null;
  starts_on: string;
  ends_on: string | null;
  is_active: boolean;
  consumed_invoice_id: string | null;
}

interface PeriodRow {
  id: string;
  status: LedgerPeriodRow["status"];
  plan_id: string;
  plan_name: string;
  valid_from: string;
  valid_to: string | null;
  reason: string | null;
}

function toInvoice(row: InvoiceRow, lines: readonly LedgerInvoiceLine[]): LedgerInvoiceRow {
  return {
    id: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    dueDate: row.due_date,
    total: row.total,
    amountDue: row.amount_due,
    isVoid: row.is_void,
    voidReason: row.void_reason,
    lines,
  };
}

function toPayment(row: PaymentRow): LedgerPaymentRow {
  return {
    id: row.id,
    amount: row.amount,
    method: row.method,
    paidOn: row.paid_on,
    recordedAt: row.recorded_at,
    recordedByName: row.recorded_by_name,
    isVoid: row.is_void,
    voidReason: row.void_reason,
  };
}

function toDiscount(row: DiscountRow): LedgerDiscountRow {
  return {
    id: row.id,
    kind: row.kind,
    referralSide: row.referral_side,
    sourceMemberName: row.source_member_name,
    amount: row.amount,
    isRecurring: row.is_recurring,
    reason: row.reason,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    isActive: row.is_active,
    consumedInvoiceId: row.consumed_invoice_id,
  };
}

function toPeriod(row: PeriodRow): LedgerPeriodRow {
  return {
    id: row.id,
    status: row.status,
    planId: row.plan_id,
    planName: row.plan_name,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    reason: row.reason,
  };
}

/** Groups the lines of a page of invoices by invoice, keeping the order the lines were created in. */
function groupLines(rows: readonly LineRow[]): Map<string, LedgerInvoiceLine[]> {
  const byInvoice = new Map<string, LedgerInvoiceLine[]>();
  for (const row of rows) {
    const line = { type: row.line_type, description: row.description, amount: row.amount };
    byInvoice.set(row.invoice_id, [...(byInvoice.get(row.invoice_id) ?? []), line]);
  }
  return byInvoice;
}

/**
 * Reads one member's ledger. Every statement names the tenant, and row level security checks it
 * again. Money owed counts allocations of payments that are not void, the same join the member
 * list uses. `executor` must run inside the tenant transaction.
 */
export function makeLedgerStore(executor: SqlExecutor, tenantId: string): LedgerStore {
  async function rows<Row>(sql: string, params: unknown[]): Promise<Row[]> {
    return (await executor.query(sql, params)) as Row[];
  }

  return {
    async invoices(memberId, page: LedgerPageRequest) {
      const [date, id] = positionParams(page.after);
      const invoices = await rows<InvoiceRow>(
        `SELECT i.id, to_char(i.period_start, ${DATE}) AS period_start,
                to_char(i.period_end, ${DATE}) AS period_end,
                to_char(i.due_date, ${DATE}) AS due_date,
                i.total, i.total - COALESCE(a.counted, 0)::int AS amount_due,
                i.is_void, i.void_reason
           FROM invoices i
           ${COUNTED_ALLOCATIONS_SQL}
          WHERE i.tenant_id = $1 AND i.member_id = $2
            AND ${afterClause("i.period_start", "$3", "$4", "i.id")}
          ORDER BY i.period_start DESC, i.id DESC
          LIMIT $5`,
        [tenantId, memberId, date, id, page.limit],
      );
      if (invoices.length === 0) return [];
      const lines = groupLines(
        await rows<LineRow>(
          `SELECT invoice_id, line_type, description, amount
             FROM invoice_lines
            WHERE tenant_id = $1 AND invoice_id = ANY($2::uuid[])
            ORDER BY created_at, id`,
          [tenantId, invoices.map((invoice) => invoice.id)],
        ),
      );
      return invoices.map((invoice) => toInvoice(invoice, lines.get(invoice.id) ?? []));
    },

    async payments(memberId, page) {
      const [date, id] = positionParams(page.after);
      const found = await rows<PaymentRow>(
        `SELECT p.id, p.amount, p.method, to_char(p.paid_on, ${DATE}) AS paid_on,
                to_char(p.submitted_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP}) AS recorded_at,
                u.name AS recorded_by_name, p.is_void, p.void_reason
           FROM payments p
           JOIN users u ON u.tenant_id = p.tenant_id AND u.id = p.recorded_by
          WHERE p.tenant_id = $1 AND p.member_id = $2
            AND ${afterClause("p.paid_on", "$3", "$4", "p.id")}
          ORDER BY p.paid_on DESC, p.id DESC
          LIMIT $5`,
        [tenantId, memberId, date, id, page.limit],
      );
      return found.map(toPayment);
    },

    async discounts(memberId, page) {
      const [date, id] = positionParams(page.after);
      const found = await rows<DiscountRow>(
        `SELECT d.id, d.kind, d.referral_side, u.name AS source_member_name, d.amount,
                d.is_recurring, d.reason, to_char(d.starts_on, ${DATE}) AS starts_on,
                to_char(d.ends_on, ${DATE}) AS ends_on, d.is_active, d.consumed_invoice_id
           FROM member_discounts d
           LEFT JOIN members sm ON sm.tenant_id = d.tenant_id AND sm.id = d.source_member_id
           LEFT JOIN users u ON u.tenant_id = sm.tenant_id AND u.id = sm.user_id
          WHERE d.tenant_id = $1 AND d.member_id = $2
            AND ${afterClause("d.starts_on", "$3", "$4", "d.id")}
          ORDER BY d.starts_on DESC, d.id DESC
          LIMIT $5`,
        [tenantId, memberId, date, id, page.limit],
      );
      return found.map(toDiscount);
    },

    async periods(memberId, page) {
      const [date, id] = positionParams(page.after);
      const found = await rows<PeriodRow>(
        `SELECT mp.id, mp.status, mp.plan_id, pl.name AS plan_name,
                to_char(mp.valid_from, ${DATE}) AS valid_from,
                to_char(mp.valid_to, ${DATE}) AS valid_to, mp.reason
           FROM membership_periods mp
           JOIN plans pl ON pl.tenant_id = mp.tenant_id AND pl.id = mp.plan_id
          WHERE mp.tenant_id = $1 AND mp.member_id = $2
            AND ${afterClause("mp.valid_from", "$3", "$4", "mp.id")}
          ORDER BY mp.valid_from DESC, mp.id DESC
          LIMIT $5`,
        [tenantId, memberId, date, id, page.limit],
      );
      return found.map(toPeriod);
    },
  };
}
