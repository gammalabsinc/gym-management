import { localDateIn } from "../domain/calendar";
import { type NotFoundError, notFound, type ValidationError } from "../domain/errors";
import { type InvoiceStatus, invoiceStatusOf } from "../domain/invoice-status";
import {
  type DiscountStatus,
  discountStatusOf,
  encodeLedgerCursor,
  type LedgerPageInput,
  type LedgerPosition,
  parseLedgerPage,
} from "../domain/member-ledger";
import { hasPermission } from "../domain/permissions";
import { ok } from "../domain/result";
import type {
  Clock,
  LedgerDiscountRow,
  LedgerInvoiceRow,
  LedgerPageRequest,
  LedgerPaymentRow,
  LedgerPeriodRow,
  LedgerUnit,
  WithTenantTx,
} from "./ports";
import { type PermissionContext, requirePermission } from "./require-permission";

export interface MemberLedgerDeps {
  readonly withUnit: WithTenantTx<LedgerUnit>;
  readonly clock: Clock;
}

/** The gym and the person come from the session, never from client input. */
export interface LedgerCaller extends PermissionContext {
  readonly tenantId: string;
  readonly userId: string;
}

export interface LedgerPage<T> {
  readonly items: readonly T[];
  /** Null on the last page. */
  readonly nextCursor: string | null;
}

export interface InvoiceView extends LedgerInvoiceRow {
  readonly status: InvoiceStatus;
  /** What is still to pay. Zero for a voided invoice, which is no longer owed. */
  readonly amountOwing: number;
}

export interface DiscountView extends LedgerDiscountRow {
  readonly status: DiscountStatus;
}

/** How one tab reads its rows and what it shows for each. `today` is the gym's local date. */
interface LedgerTab<Row, View> {
  readonly read: (
    unit: LedgerUnit,
    memberId: string,
    page: LedgerPageRequest,
  ) => Promise<readonly Row[]>;
  readonly positionOf: (row: Row) => LedgerPosition;
  readonly present: (row: Row, today: string) => View;
}

/**
 * Staff and owners read any member of their gym. Anyone else reads only the member row that
 * belongs to their own user, and another member's id looks the same as an unknown one.
 */
async function canRead(unit: LedgerUnit, ctx: LedgerCaller, memberId: string): Promise<boolean> {
  if (hasPermission(ctx.roles, "member.read")) return unit.members.exists(memberId);
  return (await unit.members.findIdByUser(ctx.userId)) === memberId;
}

/**
 * One paginated ledger list. The page is read with one extra row, which is how a next page is
 * known to exist without a count, and the status of each row comes from the shared domain rules.
 */
function makeLedgerList<Row, View>(deps: MemberLedgerDeps, tab: LedgerTab<Row, View>) {
  return requirePermission<
    LedgerPageInput,
    LedgerCaller,
    LedgerPage<View>,
    ValidationError | NotFoundError
  >("member.read.own", async (input, ctx) => {
    const parsed = parseLedgerPage(input);
    if (!parsed.ok) return parsed;
    const { memberId, limit, after } = parsed.value;
    return deps.withUnit(ctx.tenantId, async (unit) => {
      if (!(await canRead(unit, ctx, memberId))) return notFound("Member not found");
      const tenant = await unit.tenants.find();
      if (tenant === null) throw new Error("The gym of this transaction cannot be read");
      const today = localDateIn(deps.clock.now(), tenant.timezone);
      const found = await tab.read(unit, memberId, { limit: limit + 1, after });
      const rows = found.slice(0, limit);
      const last = rows.at(-1);
      const hasMore = found.length > limit && last !== undefined;
      return ok({
        items: rows.map((row) => tab.present(row, today)),
        nextCursor: hasMore ? encodeLedgerCursor(tab.positionOf(last)) : null,
      });
    });
  });
}

/** Invoices newest period first, each with its lines and a status derived from the due date and what is owed. */
export function makeMemberInvoices(deps: MemberLedgerDeps) {
  return makeLedgerList<LedgerInvoiceRow, InvoiceView>(deps, {
    read: (unit, memberId, page) => unit.ledger.invoices(memberId, page),
    positionOf: (row) => ({ date: row.periodStart, id: row.id }),
    present: (row, today) => {
      const status = invoiceStatusOf(row, today);
      return { ...row, status, amountOwing: status === "voided" ? 0 : row.amountDue };
    },
  });
}

/** Payments newest first, with who recorded each and whether it was voided. */
export function makeMemberPayments(deps: MemberLedgerDeps) {
  return makeLedgerList<LedgerPaymentRow, LedgerPaymentRow>(deps, {
    read: (unit, memberId, page) => unit.ledger.payments(memberId, page),
    positionOf: (row) => ({ date: row.paidOn, id: row.id }),
    present: (row) => row,
  });
}

/** Discounts newest start first, each Active, Consumed or Ended. */
export function makeMemberDiscounts(deps: MemberLedgerDeps) {
  return makeLedgerList<LedgerDiscountRow, DiscountView>(deps, {
    read: (unit, memberId, page) => unit.ledger.discounts(memberId, page),
    positionOf: (row) => ({ date: row.startsOn, id: row.id }),
    present: (row, today) => ({ ...row, status: discountStatusOf(row, today) }),
  });
}

/** Every membership period newest first, with its status, plan, dates and reason. */
export function makeMembershipHistory(deps: MemberLedgerDeps) {
  return makeLedgerList<LedgerPeriodRow, LedgerPeriodRow>(deps, {
    read: (unit, memberId, page) => unit.ledger.periods(memberId, page),
    positionOf: (row) => ({ date: row.validFrom, id: row.id }),
    present: (row) => row,
  });
}
