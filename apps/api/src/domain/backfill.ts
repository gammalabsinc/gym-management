import { daysBetween, isCalendarDate } from "./calendar";
import { isEmailAddress, normalizeEmail } from "./email";
import { type FieldIssue, type ValidationError, validationError } from "./errors";
import { nameIssues, phoneIssues } from "./member";
import { ACTION_TO_REACH, nextStatus, parseReason } from "./membership";
import { isMinorUnits } from "./money";
import { MAX_PAYMENT_AMOUNT, PAYMENT_METHODS, type PaymentMethod } from "./payment";
import { err, ok, type Result } from "./result";
import type { MembershipStatus } from "./standing";

export const MAX_BACKFILL_MEMBERS = 5000;
/** Far below what the amount columns hold, and the same cap a payment has. */
const MAX_AMOUNT = MAX_PAYMENT_AMOUNT;
/** The oldest join date accepted, so a typo of a century cannot generate a century of invoices. */
export const MIN_JOIN_DATE = "1990-01-01";

export const BACKFILL_STATUSES = ["active", "paused", "cancelled"] as const;
export const BACKFILL_DISCOUNT_KINDS = ["manual", "referral"] as const;
export const REFERRAL_SIDES = ["referrer", "referred"] as const;

/** A change of membership status after the join date, as the old records give it. */
export interface BackfillStatusChangeInput {
  readonly status: string;
  readonly from: string;
  readonly reason: string;
}

/** Money that was really received, on the day it was received. */
export interface BackfillPaymentInput {
  readonly paidOn: string;
  readonly amount: number;
  readonly method?: string | null | undefined;
}

/** A discount as it stands today. A referral names the member it came from. */
export interface BackfillDiscountInput {
  readonly kind: string;
  readonly amount: number;
  readonly recurring: boolean;
  readonly startsOn: string;
  readonly endsOn?: string | null | undefined;
  readonly reason?: string | null | undefined;
  readonly referralSide?: string | null | undefined;
  readonly sourceEmail?: string | null | undefined;
}

export interface BackfillMemberInput {
  readonly email: string;
  readonly fullName: string;
  readonly phone?: string | null | undefined;
  readonly joinDate: string;
  /** Left out, the day of the month of the join date. */
  readonly billingDay?: number | null | undefined;
  readonly statusHistory: readonly BackfillStatusChangeInput[];
  readonly payments: readonly BackfillPaymentInput[];
  readonly discounts: readonly BackfillDiscountInput[];
}

export interface BackfillStatusChange {
  readonly status: MembershipStatus;
  readonly from: string;
  readonly reason: string;
}

export interface BackfillPayment {
  readonly paidOn: string;
  readonly amount: number;
  readonly method: PaymentMethod;
  /** Counts payments of the same day and amount before this one, so identical payments keep distinct keys. */
  readonly ordinal: number;
}

export interface BackfillDiscount {
  readonly kind: DiscountKind;
  readonly amount: number;
  readonly isRecurring: boolean;
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly reason: string | null;
  readonly referralSide: ReferralSide | null;
  /** Lower case. Set exactly when the discount is a referral. */
  readonly sourceEmail: string | null;
}

export interface BackfillMember {
  readonly email: string;
  readonly fullName: string;
  readonly phone: string | null;
  readonly joinDate: string;
  readonly billingDay: number;
  /** Oldest first. */
  readonly statusHistory: readonly BackfillStatusChange[];
  /** Oldest first. */
  readonly payments: readonly BackfillPayment[];
  readonly discounts: readonly BackfillDiscount[];
}

type DiscountKind = (typeof BACKFILL_DISCOUNT_KINDS)[number];
type ReferralSide = (typeof REFERRAL_SIDES)[number];
type Path = readonly (string | number)[];
/** Either the value, or every problem found in it. */
type Checked<T> = Result<T, FieldIssue[]>;

function issue(path: Path, message: string): FieldIssue {
  return { path, message };
}

function pick<T extends string>(options: readonly T[], value: string): T | undefined {
  return options.find((option) => option === value);
}

/** A real date that is not in the future and not before `earliest`. */
function dateIssues(path: Path, value: string, earliest: string, today: string): FieldIssue[] {
  if (!isCalendarDate(value)) return [issue(path, "Enter a real date written YYYY-MM-DD")];
  if (daysBetween(value, today) < 0) return [issue(path, "Cannot be in the future")];
  return daysBetween(earliest, value) < 0 ? [issue(path, `Cannot be before ${earliest}`)] : [];
}

function amountIssues(path: Path, amount: number): FieldIssue[] {
  return isMinorUnits(amount) && amount > 0 && amount <= MAX_AMOUNT
    ? []
    : [issue(path, "Enter a whole amount of more than zero")];
}

function billingDayOf(billingDay: number | null | undefined, joinDate: string): Checked<number> {
  if (billingDay === null || billingDay === undefined) return ok(Number(joinDate.slice(8, 10)));
  return Number.isInteger(billingDay) && billingDay >= 1 && billingDay <= 31
    ? ok(billingDay)
    : err([issue(["billingDay"], "Must be a whole number from 1 to 31")]);
}

/** Checks a change against the status the member was in before it. */
function parseStatusChange(
  input: BackfillStatusChangeInput,
  path: Path,
  previous: { readonly status: MembershipStatus; readonly from: string },
  today: string,
): Checked<BackfillStatusChange> {
  const from = input.from.trim();
  const status = pick(BACKFILL_STATUSES, input.status.trim());
  const reason = parseReason(input.reason);
  const next = status === undefined ? null : nextStatus(ACTION_TO_REACH[status], previous.status);
  const issues = [
    ...dateIssues([...path, "from"], from, previous.from, today),
    ...(reason.ok ? [] : reason.error.issues.map((i) => issue([...path, ...i.path], i.message))),
    ...(status === undefined
      ? [issue([...path, "status"], `Use one of ${BACKFILL_STATUSES.join(", ")}`)]
      : []),
    ...(next !== null && !next.ok ? [issue([...path, "status"], next.error.message)] : []),
  ];
  return status !== undefined && reason.ok && issues.length === 0
    ? ok({ status, from, reason: reason.value })
    : err(issues);
}

function parseHistory(
  history: readonly BackfillStatusChangeInput[],
  joinDate: string,
  today: string,
): Checked<BackfillStatusChange[]> {
  const changes: BackfillStatusChange[] = [];
  const issues: FieldIssue[] = [];
  let previous: { status: MembershipStatus; from: string } = { status: "active", from: joinDate };
  history.forEach((input, index) => {
    const change = parseStatusChange(input, ["statusHistory", index], previous, today);
    if (change.ok) {
      changes.push(change.value);
      previous = change.value;
    } else issues.push(...change.error);
  });
  return issues.length === 0 ? ok(changes) : err(issues);
}

function parsePayment(
  input: BackfillPaymentInput,
  path: Path,
  joinDate: string,
  today: string,
): Checked<Omit<BackfillPayment, "ordinal">> {
  const paidOn = input.paidOn.trim();
  const method = pick(PAYMENT_METHODS, input.method?.trim() || "cash");
  const issues = [
    ...dateIssues([...path, "paidOn"], paidOn, joinDate, today),
    ...amountIssues([...path, "amount"], input.amount),
    ...(method === undefined
      ? [issue([...path, "method"], `Use one of ${PAYMENT_METHODS.join(", ")}`)]
      : []),
  ];
  return method !== undefined && issues.length === 0
    ? ok({ paidOn, amount: input.amount, method })
    : err(issues);
}

/** Payments oldest first. The sort is stable, so payments of one day keep the order of the file. */
function parsePayments(
  payments: readonly BackfillPaymentInput[],
  joinDate: string,
  today: string,
): Checked<BackfillPayment[]> {
  const parsed = payments.map((payment, index) =>
    parsePayment(payment, ["payments", index], joinDate, today),
  );
  const issues = parsed.flatMap((p) => (p.ok ? [] : p.error));
  if (issues.length > 0) return err(issues);
  const sorted = parsed
    .flatMap((p) => (p.ok ? [p.value] : []))
    .sort((a, b) => a.paidOn.localeCompare(b.paidOn));
  const seen = new Map<string, number>();
  return ok(
    sorted.map((payment) => {
      const key = `${payment.paidOn}|${payment.amount}`;
      const ordinal = seen.get(key) ?? 0;
      seen.set(key, ordinal + 1);
      return { ...payment, ordinal };
    }),
  );
}

function kindIssues(
  path: Path,
  kind: DiscountKind | undefined,
  input: BackfillDiscountInput,
  side: ReferralSide | undefined,
  source: string,
): FieldIssue[] {
  if (kind === undefined) {
    return [issue([...path, "kind"], `Use one of ${BACKFILL_DISCOUNT_KINDS.join(", ")}`)];
  }
  if (kind === "manual") {
    return input.reason?.trim() ? [] : [issue([...path, "reason"], "A reason is required")];
  }
  return [
    ...(side === undefined
      ? [issue([...path, "referralSide"], `Use one of ${REFERRAL_SIDES.join(", ")}`)]
      : []),
    ...(isEmailAddress(source)
      ? []
      : [issue([...path, "sourceEmail"], "Enter the email of the member it came from")]),
  ];
}

function endIssues(path: Path, startsOn: string, endsOn: string | null): FieldIssue[] {
  if (endsOn === null) return [];
  if (!isCalendarDate(endsOn)) return [issue(path, "Enter a real date written YYYY-MM-DD")];
  return isCalendarDate(startsOn) && daysBetween(startsOn, endsOn) < 0
    ? [issue(path, "Cannot be before startsOn")]
    : [];
}

function parseDiscount(
  input: BackfillDiscountInput,
  path: Path,
  joinDate: string,
  today: string,
): Checked<BackfillDiscount> {
  const kind = pick(BACKFILL_DISCOUNT_KINDS, input.kind.trim());
  const side = pick(REFERRAL_SIDES, input.referralSide?.trim() ?? "");
  const source = normalizeEmail(input.sourceEmail ?? "");
  const startsOn = input.startsOn.trim();
  const endsOn = input.endsOn?.trim() || null;
  const issues = [
    ...kindIssues(path, kind, input, side, source),
    ...dateIssues([...path, "startsOn"], startsOn, joinDate, today),
    ...endIssues([...path, "endsOn"], startsOn, endsOn),
    ...amountIssues([...path, "amount"], input.amount),
  ];
  if (kind === undefined || issues.length > 0) return err(issues);
  const isReferral = kind === "referral";
  return ok({
    kind,
    amount: input.amount,
    isRecurring: input.recurring,
    startsOn,
    endsOn,
    reason: isReferral ? null : (input.reason?.trim() ?? null),
    referralSide: isReferral ? (side ?? null) : null,
    sourceEmail: isReferral ? source : null,
  });
}

function parseDiscounts(
  discounts: readonly BackfillDiscountInput[],
  joinDate: string,
  today: string,
): Checked<BackfillDiscount[]> {
  const parsed = discounts.map((d, index) =>
    parseDiscount(d, ["discounts", index], joinDate, today),
  );
  const issues = parsed.flatMap((p) => (p.ok ? [] : p.error));
  return issues.length > 0 ? err(issues) : ok(parsed.flatMap((p) => (p.ok ? [p.value] : [])));
}

function identityIssues(
  input: BackfillMemberInput,
  email: string,
  joinDate: string,
  today: string,
) {
  return [
    ...nameIssues(input.fullName.trim()),
    ...(isEmailAddress(email) ? [] : [issue(["email"], "Enter a valid email address")]),
    ...phoneIssues(input.phone?.trim() ?? ""),
    ...dateIssues(["joinDate"], joinDate, MIN_JOIN_DATE, today),
  ];
}

/**
 * Checks one member of the old records and puts it in the form it is loaded in. `today` is the
 * gym's local date. Every problem is reported at once, with the path of the field.
 */
export function parseBackfillMember(
  input: BackfillMemberInput,
  today: string,
): Result<BackfillMember, ValidationError> {
  const email = normalizeEmail(input.email);
  const joinDate = input.joinDate.trim();
  const identity = identityIssues(input, email, joinDate, today);
  // Everything below is measured from the join date, so it is only checked once that date is real.
  const dated = identity.some((i) => i.path[0] === "joinDate");
  const billingDay = billingDayOf(input.billingDay, joinDate);
  const history = dated ? ok([]) : parseHistory(input.statusHistory, joinDate, today);
  const payments = dated ? ok([]) : parsePayments(input.payments, joinDate, today);
  const discounts = dated ? ok([]) : parseDiscounts(input.discounts, joinDate, today);
  const issues = [
    ...identity,
    ...[billingDay, history, payments, discounts].flatMap((part) => (part.ok ? [] : part.error)),
  ];
  if (issues.length > 0 || !billingDay.ok || !history.ok || !payments.ok || !discounts.ok) {
    return validationError("Invalid member", issues);
  }
  return ok({
    email,
    fullName: input.fullName.trim(),
    phone: input.phone?.trim() || null,
    joinDate,
    billingDay: billingDay.value,
    statusHistory: history.value,
    payments: payments.value,
    discounts: discounts.value,
  });
}

/**
 * Checks the whole file before anything is written: every member, and no email twice. A problem
 * names the member by its place in the file.
 */
export function parseBackfill(
  inputs: readonly BackfillMemberInput[],
  today: string,
): Result<readonly BackfillMember[], ValidationError> {
  if (inputs.length > MAX_BACKFILL_MEMBERS) {
    return validationError("Invalid backfill", [
      issue(["members"], `At most ${MAX_BACKFILL_MEMBERS} members in one file`),
    ]);
  }
  const members: BackfillMember[] = [];
  const issues: FieldIssue[] = [];
  const emails = new Set<string>();
  inputs.forEach((input, index) => {
    const parsed = parseBackfillMember(input, today);
    if (!parsed.ok) {
      issues.push(
        ...parsed.error.issues.map((i) => issue(["members", index, ...i.path], i.message)),
      );
      return;
    }
    if (emails.has(parsed.value.email)) {
      issues.push(issue(["members", index, "email"], "This email is in the file twice"));
    }
    emails.add(parsed.value.email);
    members.push(parsed.value);
  });
  return issues.length > 0 ? validationError("Invalid backfill", issues) : ok(members);
}
