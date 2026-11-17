import type { BillableMember, InvoiceStore, PlanFees } from "../../app/ports";
import type { Discount } from "../../domain/discounts";
import type { MembershipStatus } from "../../domain/standing";
import type { SqlExecutor } from "../db/sql-executor";

/** Dates leave Postgres as plain text, so no time zone of this process can shift a calendar day. */
const DATE = "'YYYY-MM-DD'";
const UTC_TIMESTAMP = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

interface MemberRow {
  id: string;
  billing_day: number;
  status: MembershipStatus;
  plan_id: string;
  active_from: string;
}

interface DiscountRow {
  id: string;
  amount: number;
  is_recurring: boolean;
  starts_on: string;
  ends_on: string | null;
  is_active: boolean;
  consumed_invoice_id: string | null;
  created_at: string;
}

function toMember(row: MemberRow): BillableMember {
  return {
    id: row.id,
    billingDay: row.billing_day,
    status: row.status,
    planId: row.plan_id,
    activeFrom: row.active_from,
  };
}

function toDiscount(row: DiscountRow): Discount {
  return {
    id: row.id,
    amount: row.amount,
    isRecurring: row.is_recurring,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    isActive: row.is_active,
    consumedInvoiceId: row.consumed_invoice_id,
    createdAt: row.created_at,
  };
}

/**
 * The invoices of one tenant. Every statement names the tenant, and row level security checks it
 * again. `executor` must run inside the tenant transaction.
 */
export function makeInvoiceStore(executor: SqlExecutor, tenantId: string): InvoiceStore {
  async function rows<Row>(sql: string, params: unknown[]): Promise<Row[]> {
    return (await executor.query(sql, params)) as Row[];
  }

  return {
    async lockMember(memberId) {
      const [row] = await rows<MemberRow>(
        `SELECT m.id, m.billing_day, p.status, p.plan_id,
                -- Periods touch end to start, so the stretch of active membership that holds the
                -- current period began when the last paused or cancelled period ended.
                to_char(
                  COALESCE(
                    (SELECT max(a.valid_to) FROM membership_periods a
                      WHERE a.tenant_id = m.tenant_id AND a.member_id = m.id AND a.status <> 'active'),
                    (SELECT min(a.valid_from) FROM membership_periods a
                      WHERE a.tenant_id = m.tenant_id AND a.member_id = m.id)
                  ),
                  ${DATE}
                ) AS active_from
           FROM members m
           JOIN membership_periods p
             ON p.tenant_id = m.tenant_id AND p.member_id = m.id AND p.valid_to IS NULL
          WHERE m.tenant_id = $1 AND m.id = $2
            FOR UPDATE OF m`,
        [tenantId, memberId],
      );
      return row === undefined ? null : toMember(row);
    },

    async findPlanFees(planId) {
      const [row] = await rows<{ admission_fee: number; monthly_fee: number }>(
        "SELECT admission_fee, monthly_fee FROM plans WHERE tenant_id = $1 AND id = $2",
        [tenantId, planId],
      );
      return row === undefined
        ? null
        : ({ admissionFee: row.admission_fee, monthlyFee: row.monthly_fee } satisfies PlanFees);
    },

    async lastPeriodEnd(memberId) {
      const [row] = await rows<{ last: string | null }>(
        `SELECT to_char(max(period_end), ${DATE}) AS last
           FROM invoices WHERE tenant_id = $1 AND member_id = $2`,
        [tenantId, memberId],
      );
      return row?.last ?? null;
    },

    async discountsOf(memberId) {
      const found = await rows<DiscountRow>(
        `SELECT id, amount, is_recurring, is_active, consumed_invoice_id,
                to_char(starts_on, ${DATE}) AS starts_on,
                to_char(ends_on, ${DATE}) AS ends_on,
                to_char(created_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP}) AS created_at
           FROM member_discounts
          WHERE tenant_id = $1 AND member_id = $2 AND is_active`,
        [tenantId, memberId],
      );
      return found.map(toDiscount);
    },

    async insert(memberId, draft) {
      const [invoice] = await rows<{ id: string }>(
        `INSERT INTO invoices (tenant_id, member_id, period_start, period_end, due_date, total)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (tenant_id, member_id, period_start) WHERE NOT is_void DO NOTHING
         RETURNING id`,
        [tenantId, memberId, draft.periodStart, draft.periodEnd, draft.dueDate, draft.total],
      );
      if (invoice === undefined) return null;
      await executor.query(
        `INSERT INTO invoice_lines (tenant_id, invoice_id, line_type, description, amount, discount_id)
         SELECT $1, $2, line_type, description, amount, discount_id
           FROM unnest($3::text[], $4::text[], $5::int[], $6::uuid[])
             AS line (line_type, description, amount, discount_id)`,
        [
          tenantId,
          invoice.id,
          draft.lines.map((line) => line.lineType),
          draft.lines.map((line) => line.description),
          draft.lines.map((line) => line.amount),
          draft.lines.map((line) => line.discountId),
        ],
      );
      return invoice.id;
    },

    async markConsumed(discountIds, invoiceId) {
      if (discountIds.length === 0) return;
      await executor.query(
        `UPDATE member_discounts SET consumed_invoice_id = $3, updated_at = now()
          WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, discountIds, invoiceId],
      );
    },
  };
}
