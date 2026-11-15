import { daysBetween, isCalendarDate } from "./calendar";
import { type FieldIssue, type ValidationError, validationError } from "./errors";
import { isMinorUnits, type MinorUnits } from "./money";
import { ok, type Result } from "./result";

export type Standing = "paid" | "due_soon" | "overdue" | "inactive";

/** Status of the member's current membership_periods row. */
export type MembershipStatus = "active" | "paused" | "cancelled";

/** An invoice reduced to what standing reads. */
export interface InvoiceDue {
  readonly dueDate: string;
  /** Total minus counted allocations. Zero means the invoice is paid. */
  readonly amountDue: MinorUnits;
  readonly isVoid: boolean;
}

/** Thresholds come from the tenant settings. */
export interface StandingSettings {
  readonly warnDaysBefore: number;
  readonly redDaysAfter: number;
}

export interface StandingInput extends StandingSettings {
  /** The current date in the tenant timezone. */
  readonly today: string;
  readonly membershipStatus: MembershipStatus;
  readonly invoices: readonly InvoiceDue[];
}

const MAX_THRESHOLD_DAYS = 366;

function issue(path: readonly (string | number)[], message: string): FieldIssue {
  return { path, message };
}

function isThreshold(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_THRESHOLD_DAYS;
}

function validateInvoice(invoice: InvoiceDue, index: number): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if (!isCalendarDate(invoice.dueDate)) {
    issues.push(issue(["invoices", index, "dueDate"], "must be a real date written YYYY-MM-DD"));
  }
  if (!isMinorUnits(invoice.amountDue) || invoice.amountDue < 0) {
    issues.push(
      issue(
        ["invoices", index, "amountDue"],
        "must be a whole number of minor units, zero or more",
      ),
    );
  }
  return issues;
}

function validate(input: StandingInput): Result<StandingInput, ValidationError> {
  const issues: FieldIssue[] = [];
  if (!isCalendarDate(input.today)) {
    issues.push(issue(["today"], "must be a real date written YYYY-MM-DD"));
  }
  for (const field of ["warnDaysBefore", "redDaysAfter"] as const) {
    if (!isThreshold(input[field])) {
      issues.push(issue([field], `must be a whole number of days from 0 to ${MAX_THRESHOLD_DAYS}`));
    }
  }
  input.invoices.forEach((invoice, index) => {
    issues.push(...validateInvoice(invoice, index));
  });
  return issues.length === 0 ? ok(input) : validationError("Invalid standing input", issues);
}

/** The oldest unpaid invoice decides standing. Voided and fully paid invoices are ignored. */
function oldestUnpaidDueDate(invoices: readonly InvoiceDue[]): string | null {
  return invoices
    .filter((invoice) => !invoice.isVoid && invoice.amountDue > 0)
    .reduce<string | null>(
      (oldest, invoice) => (oldest === null || invoice.dueDate < oldest ? invoice.dueDate : oldest),
      null,
    );
}

function standingForDueDate(dueDate: string | null, input: StandingInput): Standing {
  if (dueDate === null) return "paid";
  const daysPastDue = daysBetween(dueDate, input.today);
  if (daysPastDue < -input.warnDaysBefore) return "paid";
  return daysPastDue <= input.redDaysAfter ? "due_soon" : "overdue";
}

/**
 * The one place standing is decided. A paused or cancelled membership is inactive whatever the
 * invoices say. Otherwise the oldest unpaid invoice decides: paid until it is more than
 * warnDaysBefore days away, due_soon from there until redDaysAfter days past its due date, then
 * overdue. Entry is never blocked in any standing, this only labels it.
 */
export function standingOf(input: StandingInput): Result<Standing, ValidationError> {
  const checked = validate(input);
  if (!checked.ok) return checked;
  if (input.membershipStatus !== "active") return ok("inactive");
  return ok(standingForDueDate(oldestUnpaidDueDate(input.invoices), input));
}
