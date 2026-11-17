import type { MemberQueryStore } from "../../app/ports";
import type { MemberView } from "../../domain/member-view";
import type { MembershipStatus, Standing } from "../../domain/standing";
import type { SqlExecutor } from "../db/sql-executor";

const DATE = "'YYYY-MM-DD'";

/**
 * The one SQL expression for standing. It is the SQL twin of standingOf in the domain: a paused or
 * cancelled membership is inactive, otherwise the oldest unpaid live invoice decides. $2 is the
 * gym's local date, $3 the warning days before and $4 the days after the due date that stay amber.
 * A parity test runs both over a table of cases, so the two can never drift.
 */
export const STANDING_SQL = `CASE
  WHEN p.status <> 'active' THEN 'inactive'
  WHEN mm.oldest_unpaid IS NULL THEN 'paid'
  WHEN ($2::date - mm.oldest_unpaid) < -$3::int THEN 'paid'
  WHEN ($2::date - mm.oldest_unpaid) <= $4::int THEN 'due_soon'
  ELSE 'overdue'
END`;

/** Overdue first. Keep in step with STANDING_RANK in the domain. */
const RANK_SQL = `CASE s.standing
  WHEN 'overdue' THEN 0 WHEN 'due_soon' THEN 1 WHEN 'paid' THEN 2 ELSE 3
END`;

/**
 * Every member of the tenant with the derived fields. Money is counted from live invoices and
 * from allocations of payments that are not void. The sums are cast to int because every amount
 * in the schema is a 32 bit integer.
 */
const MEMBER_ROWS = `
  WITH invoice_due AS (
    SELECT i.member_id, i.due_date, i.period_start, i.period_end,
           COALESCE(a.counted, 0)::int AS counted,
           i.total - COALESCE(a.counted, 0)::int AS amount_due
      FROM invoices i
      LEFT JOIN LATERAL (
        SELECT sum(al.amount) AS counted
          FROM payment_allocations al
          JOIN payments pay
            ON pay.tenant_id = al.tenant_id AND pay.id = al.payment_id AND NOT pay.is_void
         WHERE al.tenant_id = i.tenant_id AND al.invoice_id = i.id
      ) a ON true
     WHERE i.tenant_id = $1 AND NOT i.is_void
  ),
  member_money AS (
    SELECT member_id,
           min(due_date) FILTER (WHERE amount_due > 0) AS oldest_unpaid,
           COALESCE(sum(amount_due) FILTER (WHERE due_date <= $2::date), 0)::int AS balance_due,
           COALESCE(sum(counted) FILTER (
             WHERE period_start <= $2::date AND period_end >= $2::date), 0)::int AS total_paid
      FROM invoice_due
     GROUP BY member_id
  ),
  received AS (
    SELECT member_id, sum(amount)::int AS amount
      FROM payments WHERE tenant_id = $1 AND NOT is_void GROUP BY member_id
  ),
  used AS (
    SELECT pay.member_id, sum(al.amount)::int AS amount
      FROM payment_allocations al
      JOIN payments pay
        ON pay.tenant_id = al.tenant_id AND pay.id = al.payment_id AND NOT pay.is_void
      JOIN invoices inv
        ON inv.tenant_id = al.tenant_id AND inv.id = al.invoice_id AND NOT inv.is_void
     WHERE al.tenant_id = $1
     GROUP BY pay.member_id
  ),
  visit_counts AS (
    SELECT member_id,
           (count(*) FILTER (WHERE local_date >= $6::date AND local_date < $7::date))::int AS this_month,
           (count(*) FILTER (WHERE local_date >= $5::date AND local_date < $6::date))::int AS last_month
      FROM attendance
     WHERE tenant_id = $1 AND NOT is_duplicate AND local_date >= $5::date AND local_date < $7::date
     GROUP BY member_id
  ),
  base AS (
    SELECT m.id, m.member_no, m.barcode, m.billing_day, m.referred_by,
           u.name, u.email, u.phone, u.photo_ref,
           p.status,
           pl.id AS plan_id, pl.key AS plan_key, pl.name AS plan_name,
           pl.admission_fee, pl.monthly_fee, pl.is_active AS plan_is_active,
           (SELECT to_char(min(f.valid_from), ${DATE}) FROM membership_periods f
             WHERE f.tenant_id = m.tenant_id AND f.member_id = m.id) AS joined_on,
           CASE WHEN p.status = 'cancelled' THEN to_char(p.valid_from, ${DATE}) END AS left_on,
           (SELECT to_char(max(d.period_end), ${DATE}) FROM invoice_due d
             WHERE d.member_id = m.id AND d.amount_due = 0
               AND (mm.oldest_unpaid IS NULL OR d.period_start < mm.oldest_unpaid)) AS paid_through,
           ${STANDING_SQL} AS standing,
           COALESCE(mm.balance_due, 0) AS balance_due,
           COALESCE(rc.amount, 0) - COALESCE(us.amount, 0) AS credit,
           COALESCE(vc.this_month, 0) AS visits_this_month,
           COALESCE(vc.last_month, 0) AS visits_last_month,
           COALESCE(mm.total_paid, 0) AS total_paid,
           lower(COALESCE(NULLIF(u.name, ''), u.email)) AS sort_name
      FROM members m
      JOIN users u ON u.tenant_id = m.tenant_id AND u.id = m.user_id
      JOIN membership_periods p
        ON p.tenant_id = m.tenant_id AND p.member_id = m.id AND p.valid_to IS NULL
      JOIN plans pl ON pl.tenant_id = p.tenant_id AND pl.id = p.plan_id
      LEFT JOIN member_money mm ON mm.member_id = m.id
      LEFT JOIN received rc ON rc.member_id = m.id
      LEFT JOIN used us ON us.member_id = m.id
      LEFT JOIN visit_counts vc ON vc.member_id = m.id
     WHERE m.tenant_id = $1
  )`;

/** $8 is the search pattern or null, $9 a list of member ids or null, $10 to $12 the cursor or null, $13 the limit. */
const SELECT_PAGE = `${MEMBER_ROWS}
  SELECT r.* FROM (SELECT s.*, ${RANK_SQL} AS rank FROM base s) r
   WHERE ($8::text IS NULL
          OR r.name ILIKE $8::text ESCAPE '\\'
          OR r.email ILIKE $8::text ESCAPE '\\'
          OR r.member_no ILIKE $8::text ESCAPE '\\')
     AND ($9::uuid[] IS NULL OR r.id = ANY($9::uuid[]))
     AND ($10::int IS NULL OR (r.rank, r.sort_name, r.id) > ($10::int, $11::text, $12::uuid))
   ORDER BY r.rank, r.sort_name, r.id
   LIMIT $13::int`;

interface Row {
  id: string;
  member_no: string;
  barcode: string;
  billing_day: number;
  referred_by: string | null;
  name: string | null;
  email: string;
  phone: string | null;
  photo_ref: string | null;
  status: MembershipStatus;
  plan_id: string;
  plan_key: string;
  plan_name: string;
  admission_fee: number;
  monthly_fee: number;
  plan_is_active: boolean;
  joined_on: string;
  left_on: string | null;
  paid_through: string | null;
  standing: Standing;
  balance_due: number;
  credit: number;
  visits_this_month: number;
  visits_last_month: number;
  total_paid: number;
  sort_name: string;
}

function toView(row: Row): MemberView {
  return {
    id: row.id,
    memberNo: row.member_no,
    barcode: row.barcode,
    name: row.name,
    email: row.email,
    phone: row.phone,
    photoRef: row.photo_ref,
    status: row.status,
    plan: {
      id: row.plan_id,
      key: row.plan_key,
      name: row.plan_name,
      admissionFee: row.admission_fee,
      monthlyFee: row.monthly_fee,
      isActive: row.plan_is_active,
    },
    joinedOn: row.joined_on,
    leftOn: row.left_on,
    billingDay: row.billing_day,
    referredBy: row.referred_by,
    paidThrough: row.paid_through,
    standing: row.standing,
    balanceDue: row.balance_due,
    credit: row.credit,
    visitsThisMonth: row.visits_this_month,
    visitsLastMonth: row.visits_last_month,
    totalPaid: row.total_paid,
  };
}

/** Turns the typed words into a LIKE pattern, so % and _ in a name are matched as plain text. */
export function likePattern(search: string): string {
  return `%${search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

/**
 * Reads the members of one tenant. Every value reaches the database as a parameter, including the
 * search text. `executor` must run inside the tenant transaction, and every statement names the
 * tenant too.
 */
export function makeMemberQueryStore(executor: SqlExecutor, tenantId: string): MemberQueryStore {
  async function page(
    context: Parameters<MemberQueryStore["find"]>[1],
    filters: {
      search: string | null;
      memberIds: readonly string[] | null;
      after: { rank: number; sortName: string; id: string } | null;
      limit: number;
    },
  ): Promise<Row[]> {
    return (await executor.query(SELECT_PAGE, [
      tenantId,
      context.today,
      context.warnDaysBefore,
      context.redDaysAfter,
      context.lastMonthStart,
      context.thisMonthStart,
      context.nextMonthStart,
      filters.search === null ? null : likePattern(filters.search),
      filters.memberIds,
      filters.after?.rank ?? null,
      filters.after?.sortName ?? null,
      filters.after?.id ?? null,
      filters.limit,
    ])) as Row[];
  }

  return {
    async find(memberId, context) {
      const [row] = await page(context, {
        search: null,
        memberIds: [memberId],
        after: null,
        limit: 1,
      });
      return row === undefined ? null : toView(row);
    },

    async findMany(memberIds, context) {
      if (memberIds.length === 0) return [];
      const rows = await page(context, {
        search: null,
        memberIds,
        after: null,
        limit: memberIds.length,
      });
      return rows.map(toView);
    },

    async list(request, context) {
      const rows = await page(context, {
        search: request.search,
        memberIds: null,
        after: request.after,
        limit: request.limit,
      });
      return rows.map((row) => ({ member: toView(row), sortName: row.sort_name }));
    },
  };
}
