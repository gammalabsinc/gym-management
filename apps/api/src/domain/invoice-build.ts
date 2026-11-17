import { type BillingCycle, cyclesFrom, type DateText, MAX_CYCLES_PER_CALL } from "./billing-cycle";
import { isCalendarDate, nextDate } from "./calendar";
import { applyDiscounts, type Discount } from "./discounts";
import { type FieldIssue, type ValidationError, validationError } from "./errors";
import { isMinorUnits, type MinorUnits, sumMinor } from "./money";
import { andThen, ok, type Result } from "./result";

/** How many cycles after the current one a prepayment may generate. */
export const MAX_AHEAD_CYCLES = 12;

export type InvoiceLineType = "membership" | "admission" | "discount";

export interface InvoiceLineDraft {
  readonly lineType: InvoiceLineType;
  readonly description: string;
  /** Signed minor units. Discount lines are negative. */
  readonly amount: MinorUnits;
  /** The discount a discount line came from, null on every other line. */
  readonly discountId: string | null;
}

export interface InvoiceDraft {
  readonly periodStart: DateText;
  readonly periodEnd: DateText;
  /** Members pay in advance, so an invoice is due on the day its cycle starts. */
  readonly dueDate: DateText;
  readonly lines: readonly InvoiceLineDraft[];
  readonly total: MinorUnits;
  /** One time discounts that landed on this invoice and must not land on another. */
  readonly consumedDiscountIds: readonly string[];
}

export interface CyclesToGenerate {
  readonly billingDay: number;
  /**
   * First day of the member's current stretch of active membership: the join date, or the day they
   * came back from a pause or a cancellation. Billing never goes back before it.
   */
  readonly activeFrom: DateText;
  /** The `period_end` of the member's latest invoice, void ones included, or null for none. */
  readonly lastPeriodEnd: DateText | null;
  /** Today in the gym's time zone. */
  readonly today: DateText;
  /** Cycles to build after the one that holds today, from 0 to MAX_AHEAD_CYCLES. */
  readonly ahead: number;
}

/** The later of two dates written YYYY-MM-DD. */
function latest(a: DateText, b: DateText): DateText {
  return a > b ? a : b;
}

function invalid(path: string, message: string): Result<never, ValidationError> {
  return validationError(`${path} ${message}`, [{ path: [path], message }]);
}

/**
 * The cycles that still need an invoice: every cycle after the member's latest invoice, up to the
 * one `ahead` cycles past today. A void invoice still counts as billed, so voiding an invoice never
 * makes the next run build it again. Cycles the member spent paused or cancelled are never built.
 * A cycle that began before the first day still to bill is skipped, so a changed billing day can
 * never overlap an invoice that already exists. The first invoice of a member is the exception: it
 * is the cycle that holds the day they joined, even when that cycle began a few days earlier.
 */
export function cyclesToGenerate(
  input: CyclesToGenerate,
): Result<readonly BillingCycle[], ValidationError> {
  const { billingDay, activeFrom, lastPeriodEnd, today, ahead } = input;
  if (!Number.isInteger(ahead) || ahead < 0 || ahead > MAX_AHEAD_CYCLES) {
    return invalid("ahead", `must be a whole number from 0 to ${MAX_AHEAD_CYCLES}`);
  }
  if (lastPeriodEnd !== null && !isCalendarDate(lastPeriodEnd)) {
    return invalid("lastPeriodEnd", "must be a real date written YYYY-MM-DD");
  }
  const dayAfterLast = lastPeriodEnd === null ? null : nextDate(lastPeriodEnd);
  const afterLast = dayAfterLast === null ? null : latest(dayAfterLast, activeFrom);
  const firstDay = afterLast ?? activeFrom;
  return andThen(cyclesFrom(billingDay, today, ahead + 1), (window) =>
    andThen(cyclesFrom(billingDay, firstDay, MAX_CYCLES_PER_CALL), (candidates) => {
      // The window ends with the last cycle wanted, so its start is the latest start to build.
      const latestStart = window.reduce((_, cycle) => cycle.start, today);
      return ok(
        candidates.filter(
          (cycle) => (afterLast === null || cycle.start >= afterLast) && cycle.start <= latestStart,
        ),
      );
    }),
  );
}

export interface BuildInvoice {
  readonly cycle: BillingCycle;
  /** The plan's fees as they are now. An invoice already built never changes. */
  readonly monthlyFee: MinorUnits;
  readonly admissionFee: MinorUnits;
  /** True for the member's first invoice, the only one that carries the admission fee. */
  readonly isFirst: boolean;
  readonly discounts: readonly Discount[];
}

function validateFees({ monthlyFee, admissionFee }: BuildInvoice): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (!isMinorUnits(monthlyFee) || monthlyFee < 0) {
    issues.push({ path: ["monthlyFee"], message: "must be a whole number of minor units" });
  }
  if (!isMinorUnits(admissionFee) || admissionFee < 0) {
    issues.push({ path: ["admissionFee"], message: "must be a whole number of minor units" });
  }
  return issues;
}

/**
 * One invoice for one cycle: the membership line, the admission line on the first invoice only,
 * then the discount lines. Discounts reduce the membership line and never the admission fee.
 */
export function buildInvoice(input: BuildInvoice): Result<InvoiceDraft, ValidationError> {
  const issues = validateFees(input);
  if (issues.length > 0) return validationError("Invalid invoice input", issues);
  const { cycle, monthlyFee, admissionFee, isFirst, discounts } = input;
  return andThen(
    applyDiscounts({ membershipFee: monthlyFee, periodStart: cycle.start, discounts }),
    (outcome) => {
      const lines: InvoiceLineDraft[] = [
        {
          lineType: "membership",
          description: "Monthly fee",
          amount: monthlyFee,
          discountId: null,
        },
        ...(isFirst && admissionFee > 0
          ? [
              {
                lineType: "admission" as const,
                description: "Admission fee",
                amount: admissionFee,
                discountId: null,
              },
            ]
          : []),
        ...outcome.lines.map((line) => ({
          lineType: "discount" as const,
          description: "Discount",
          amount: line.amount,
          discountId: line.discountId,
        })),
      ];
      return andThen(sumMinor(lines.map((line) => line.amount)), (total) =>
        ok({
          periodStart: cycle.start,
          periodEnd: cycle.end,
          dueDate: cycle.start,
          lines,
          total,
          consumedDiscountIds: outcome.lines
            .filter((line) => line.consumes)
            .map((line) => line.discountId),
        }),
      );
    },
  );
}
