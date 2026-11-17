import {
  type ConflictError,
  conflict,
  type FieldIssue,
  type ValidationError,
  validationError,
} from "./errors";
import { discountStatusOf } from "./member-ledger";
import { parseReason } from "./membership";
import { isMinorUnits } from "./money";
import { ok, type Result } from "./result";
import { parseUuid } from "./uuid";

/** The amount column is a 32 bit integer, so a larger amount is refused here and never reaches it. */
export const MAX_DISCOUNT_AMOUNT = 2_147_483_647;

/** What the owner types on the add discount sheet. */
export interface ManualDiscountInput {
  readonly memberId: string;
  /** Flat minor units off the monthly fee, greater than zero. */
  readonly amount: number;
  /** True takes the amount off every invoice, false takes it off one. */
  readonly isRecurring: boolean;
  readonly reason: string;
}

export interface NewManualDiscount {
  readonly memberId: string;
  readonly amount: number;
  readonly isRecurring: boolean;
  readonly reason: string;
}

function amountIssue(amount: unknown): FieldIssue[] {
  const valid = isMinorUnits(amount) && amount >= 1 && amount <= MAX_DISCOUNT_AMOUNT;
  return valid
    ? []
    : [{ path: ["amount"], message: `Must be a whole number from 1 to ${MAX_DISCOUNT_AMOUNT}` }];
}

function cadenceIssue(isRecurring: unknown): FieldIssue[] {
  return typeof isRecurring === "boolean"
    ? []
    : [{ path: ["isRecurring"], message: "Choose one time or monthly" }];
}

/** Checks a new manual discount at the boundary. Every problem is reported at once. */
export function parseManualDiscount(
  input: ManualDiscountInput,
): Result<NewManualDiscount, ValidationError> {
  const memberId = parseUuid(input.memberId, "memberId");
  const reason = parseReason(input.reason);
  const issues = [
    ...(memberId.ok ? [] : memberId.error.issues),
    ...amountIssue(input.amount),
    ...cadenceIssue(input.isRecurring),
    ...(reason.ok ? [] : reason.error.issues),
  ];
  if (!memberId.ok || !reason.ok || issues.length > 0) {
    return validationError("Invalid discount", issues);
  }
  return ok({
    memberId: memberId.value,
    amount: input.amount,
    isRecurring: input.isRecurring,
    reason: reason.value,
  });
}

/** Parses the id of the discount to end. */
export function parseEndDiscount(input: {
  readonly discountId: string;
}): Result<string, ValidationError> {
  const id = parseUuid(input.discountId, "discountId");
  return id.ok ? id : validationError("Invalid discount", id.error.issues);
}

/** A discount as the end rule reads it. */
export interface EndableDiscount {
  readonly isRecurring: boolean;
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly isActive: boolean;
  readonly consumedInvoiceId: string | null;
}

export const ONE_TIME_MESSAGE = "Only a monthly discount can be ended";
export const ALREADY_ENDED_MESSAGE = "This discount has already ended";
export const NOT_STARTED_MESSAGE = "This discount has not started yet";

/**
 * The last day a monthly discount covers once it is ended: today, the gym's local date. Invoices
 * that were already generated keep what they were built with, so only invoices for cycles that
 * start after today lose the discount. A one time, ended or not yet started discount is refused.
 */
export function endDateFor(
  discount: EndableDiscount,
  today: string,
): Result<string, ConflictError> {
  if (!discount.isRecurring) return conflict(ONE_TIME_MESSAGE);
  if (discountStatusOf(discount, today) !== "active") return conflict(ALREADY_ENDED_MESSAGE);
  if (discount.startsOn > today) return conflict(NOT_STARTED_MESSAGE);
  return ok(today);
}
