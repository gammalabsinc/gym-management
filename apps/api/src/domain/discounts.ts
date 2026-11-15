import { isCalendarDate } from "./calendar";
import { type FieldIssue, type ValidationError, validationError } from "./errors";
import { isMinorUnits, type MinorUnits, sumMinor } from "./money";
import { andThen, ok, type Result } from "./result";

/** One row of member_discounts, reduced to what the cap rules read. */
export interface Discount {
  readonly id: string;
  /** Flat minor units, greater than zero. */
  readonly amount: MinorUnits;
  /** False means one time. */
  readonly isRecurring: boolean;
  readonly startsOn: string;
  /** Null while the discount is open. */
  readonly endsOn: string | null;
  readonly isActive: boolean;
  /** Set once a one time discount has landed on an invoice. */
  readonly consumedInvoiceId: string | null;
  /** UTC timestamp text, used with the id to put discounts oldest first. */
  readonly createdAt: string;
}

export interface DiscountRequest {
  /** The plan's monthly fee as it is today. Discounts reduce this line only. */
  readonly membershipFee: MinorUnits;
  /** Start of the cycle the invoice covers. */
  readonly periodStart: string;
  readonly discounts: readonly Discount[];
}

export interface AppliedDiscount {
  readonly discountId: string;
  /** Negative, the signed amount of the invoice line. Never below minus the remaining fee. */
  readonly amount: MinorUnits;
  /** True when a one time discount landed, even if the cap cut it short. */
  readonly consumes: boolean;
}

export interface DiscountOutcome {
  readonly lines: readonly AppliedDiscount[];
  /** Sum of the line amounts. Zero or negative, and never more than the membership fee. */
  readonly total: MinorUnits;
}

function issue(path: readonly (string | number)[], message: string): FieldIssue {
  return { path, message };
}

function validateDiscount(discount: Discount, index: number): FieldIssue[] {
  const at = (field: string) => ["discounts", index, field];
  const issues: FieldIssue[] = [];
  if (!isMinorUnits(discount.amount) || discount.amount <= 0) {
    issues.push(issue(at("amount"), "must be a whole number of minor units above zero"));
  }
  if (!isCalendarDate(discount.startsOn)) {
    issues.push(issue(at("startsOn"), "must be a real date written YYYY-MM-DD"));
  }
  if (discount.endsOn !== null && !isCalendarDate(discount.endsOn)) {
    issues.push(issue(at("endsOn"), "must be a real date written YYYY-MM-DD"));
  }
  return issues;
}

function validateRequest(request: DiscountRequest): Result<DiscountRequest, ValidationError> {
  const issues: FieldIssue[] = [];
  if (!isMinorUnits(request.membershipFee) || request.membershipFee < 0) {
    issues.push(issue(["membershipFee"], "must be a whole number of minor units, zero or more"));
  }
  if (!isCalendarDate(request.periodStart)) {
    issues.push(issue(["periodStart"], "must be a real date written YYYY-MM-DD"));
  }
  request.discounts.forEach((discount, index) => {
    issues.push(...validateDiscount(discount, index));
  });
  return issues.length === 0 ? ok(request) : validationError("Invalid discount input", issues);
}

/** Dates are inclusive: a discount covers its start day and its end day. */
function covers(discount: Discount, periodStart: string): boolean {
  return (
    discount.isActive &&
    discount.startsOn <= periodStart &&
    (discount.endsOn === null || periodStart <= discount.endsOn)
  );
}

function isAvailable(discount: Discount, periodStart: string): boolean {
  return (
    covers(discount, periodStart) && (discount.isRecurring || discount.consumedInvoiceId === null)
  );
}

function oldestFirst(a: Discount, b: Discount): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

interface Pass {
  readonly remaining: MinorUnits;
  readonly lines: readonly AppliedDiscount[];
}

function applyOne(pass: Pass, discount: Discount): Pass {
  const applied = Math.min(discount.amount, pass.remaining);
  // Nothing left to reduce: no line, and a one time discount stays unspent for a later invoice.
  if (applied === 0) return pass;
  return {
    remaining: pass.remaining - applied,
    lines: [
      ...pass.lines,
      { discountId: discount.id, amount: -applied, consumes: !discount.isRecurring },
    ],
  };
}

/**
 * Builds the discount lines of one invoice. Discounts apply oldest first and reduce the
 * membership line only, stopping when it reaches zero. The part of a discount the cap cuts off is
 * lost: it is not carried to a later invoice and not refunded.
 */
export function applyDiscounts(request: DiscountRequest): Result<DiscountOutcome, ValidationError> {
  return andThen(validateRequest(request), ({ membershipFee, periodStart, discounts }) => {
    const { lines } = discounts
      .filter((discount) => isAvailable(discount, periodStart))
      .sort(oldestFirst)
      .reduce<Pass>(applyOne, { remaining: membershipFee, lines: [] });
    return andThen(sumMinor(lines.map((line) => line.amount)), (total) => ok({ lines, total }));
  });
}
