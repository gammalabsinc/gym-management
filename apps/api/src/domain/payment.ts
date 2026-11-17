import { daysBetween, isCalendarDate } from "./calendar";
import { type FieldIssue, type ValidationError, validationError } from "./errors";
import { isMinorUnits, type MinorUnits } from "./money";
import { ok, type Result } from "./result";
import { parseUuid } from "./uuid";

export const PAYMENT_METHODS = ["cash", "card", "bank_transfer"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** One payment cannot be larger than this, which is far below what the database column holds. */
export const MAX_PAYMENT_AMOUNT = 100_000_000;
export const MAX_PROOF_LINK_LENGTH = 2000;

/** What staff type on the record payment screen. The id is the key that makes a retry safe. */
export interface RecordPaymentInput {
  readonly clientRequestId: string;
  readonly memberId: string;
  readonly amount: number;
  readonly method: string;
  /** The gym's local date the money was received. Left out, it is today. */
  readonly paidOn?: string | null | undefined;
  readonly proofLink?: string | null | undefined;
}

/** A payment ready to store: every field checked and in the form it is kept in. */
export interface NewPayment {
  readonly clientRequestId: string;
  readonly memberId: string;
  readonly amount: MinorUnits;
  readonly method: PaymentMethod;
  readonly paidOn: string;
  readonly proofLink: string | null;
}

/** An invoice reduced to what allocation reads. */
export interface UnpaidInvoice {
  readonly invoiceId: string;
  /** Total minus counted allocations. Always more than zero here. */
  readonly amountDue: MinorUnits;
}

export interface Allocation {
  readonly invoiceId: string;
  readonly amount: MinorUnits;
}

export interface PaymentAllocation {
  readonly allocations: readonly Allocation[];
  /** What is left after every invoice given was paid. It is the member's credit. */
  readonly remainder: MinorUnits;
}

function isPaymentMethod(value: string): value is PaymentMethod {
  return PAYMENT_METHODS.some((method) => method === value);
}

function isHttpUrl(text: string): boolean {
  return /^https?:\/\//i.test(text) && URL.canParse(text);
}

function amountIssues(amount: unknown): FieldIssue[] {
  if (!isMinorUnits(amount) || amount <= 0) {
    return [{ path: ["amount"], message: "Enter a whole amount of more than zero" }];
  }
  return amount > MAX_PAYMENT_AMOUNT
    ? [{ path: ["amount"], message: `At most ${MAX_PAYMENT_AMOUNT} minor units` }]
    : [];
}

function paidOnIssues(paidOn: string, today: string): FieldIssue[] {
  if (!isCalendarDate(paidOn)) {
    return [{ path: ["paidOn"], message: "Enter a real date written YYYY-MM-DD" }];
  }
  return daysBetween(paidOn, today) < 0
    ? [{ path: ["paidOn"], message: "Cannot be in the future" }]
    : [];
}

function proofLinkIssues(proofLink: string): FieldIssue[] {
  if (proofLink === "") return [];
  if (proofLink.length > MAX_PROOF_LINK_LENGTH) {
    return [{ path: ["proofLink"], message: `At most ${MAX_PROOF_LINK_LENGTH} characters` }];
  }
  return isHttpUrl(proofLink)
    ? []
    : [{ path: ["proofLink"], message: "Enter a link that starts with http:// or https://" }];
}

/**
 * Checks a payment and puts it in the form it is stored in. `today` is the gym's local date, so
 * "in the future" means the gym's calendar and not the server's. Every problem is reported.
 */
export function parseRecordPayment(
  input: RecordPaymentInput,
  today: string,
): Result<NewPayment, ValidationError> {
  const clientRequestId = parseUuid(input.clientRequestId, "clientRequestId");
  const memberId = parseUuid(input.memberId, "memberId");
  const method = input.method.trim();
  const paidOn = input.paidOn?.trim() || today;
  const proofLink = input.proofLink?.trim() ?? "";
  const issues = [
    ...(clientRequestId.ok ? [] : clientRequestId.error.issues),
    ...(memberId.ok ? [] : memberId.error.issues),
    ...amountIssues(input.amount),
    ...(isPaymentMethod(method)
      ? []
      : [{ path: ["method"], message: `Use one of ${PAYMENT_METHODS.join(", ")}` }]),
    ...paidOnIssues(paidOn, today),
    ...proofLinkIssues(proofLink),
  ];
  if (issues.length === 0 && clientRequestId.ok && memberId.ok && isPaymentMethod(method)) {
    return ok({
      clientRequestId: clientRequestId.value,
      memberId: memberId.value,
      amount: input.amount,
      method,
      paidOn,
      proofLink: proofLink === "" ? null : proofLink,
    });
  }
  return validationError("Invalid payment", issues);
}

/**
 * Pays the invoices in the order given, oldest first, each as far as the money goes. An invoice
 * may be paid in part, and whatever is left when the invoices run out is the remainder. No
 * allocation is ever more than the invoice is owed or than the payment held, so their sum cannot
 * exceed the payment.
 */
export function allocateOldestFirst(
  amount: MinorUnits,
  invoices: readonly UnpaidInvoice[],
): PaymentAllocation {
  const allocations: Allocation[] = [];
  let remainder = amount;
  for (const invoice of invoices) {
    if (remainder === 0) break;
    const share = Math.min(remainder, invoice.amountDue);
    if (share <= 0) continue;
    allocations.push({ invoiceId: invoice.invoiceId, amount: share });
    remainder -= share;
  }
  return { allocations, remainder };
}

/** What the payment preview asks for. Left out, the amount is the one the server suggests. */
export interface PreviewPaymentInput {
  readonly memberId: string;
  readonly amount?: number | null | undefined;
}

/** A preview ready to run. A null amount means the suggested one. */
export interface NewPreview {
  readonly memberId: string;
  readonly amount: MinorUnits | null;
}

/**
 * Checks a preview request with the same rules a payment has, so an amount that would be refused
 * when recording is refused here too. Money is whole minor units, so an amount with more than two
 * decimal places in the gym's currency can never get through.
 */
export function parsePreviewPayment(
  input: PreviewPaymentInput,
): Result<NewPreview, ValidationError> {
  const memberId = parseUuid(input.memberId, "memberId");
  const amount = input.amount ?? null;
  const issues = [
    ...(memberId.ok ? [] : memberId.error.issues),
    ...(amount === null ? [] : amountIssues(amount)),
  ];
  return issues.length === 0 && memberId.ok
    ? ok({ memberId: memberId.value, amount })
    : validationError("Invalid payment preview", issues);
}

/** One live invoice of a member as the ledger holds it. Void invoices are not part of it. */
export interface LedgerInvoice {
  readonly invoiceId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly dueDate: string;
  /** Total minus the allocations that count. Zero means the invoice is paid. */
  readonly amountDue: MinorUnits;
}

/** The invoices still owing money, oldest cycle first, the order a payment settles them in. */
export function unpaidOf(invoices: readonly LedgerInvoice[]): readonly UnpaidInvoice[] {
  return invoices
    .filter((invoice) => invoice.amountDue > 0)
    .toSorted(
      (a, b) =>
        a.periodStart.localeCompare(b.periodStart) || a.invoiceId.localeCompare(b.invoiceId),
    )
    .map((invoice) => ({ invoiceId: invoice.invoiceId, amountDue: invoice.amountDue }));
}

/** The ledger after allocations have settled invoices. An allocation never takes it below zero. */
export function applyAllocations(
  invoices: readonly LedgerInvoice[],
  allocations: readonly Allocation[],
): readonly LedgerInvoice[] {
  return invoices.map((invoice) => {
    const settled = allocations
      .filter((allocation) => allocation.invoiceId === invoice.invoiceId)
      .reduce((sum, allocation) => sum + allocation.amount, 0);
    return { ...invoice, amountDue: Math.max(0, invoice.amountDue - settled) };
  });
}

/**
 * The last day covered by paid invoices that come before the oldest unpaid one. It is the twin
 * of the paid through column the member queries read, and says null when nothing is paid yet.
 */
export function paidThroughOf(invoices: readonly LedgerInvoice[]): string | null {
  const oldestUnpaid = invoices
    .filter((invoice) => invoice.amountDue > 0)
    .map((invoice) => invoice.dueDate)
    .toSorted()[0];
  const covered = invoices
    .filter(
      (invoice) =>
        invoice.amountDue === 0 &&
        (oldestUnpaid === undefined || invoice.periodStart < oldestUnpaid),
    )
    .map((invoice) => invoice.periodEnd)
    .toSorted();
  return covered.at(-1) ?? null;
}

/**
 * The amount to prefill: what the member owes on invoices due by today, or when nothing is due
 * yet the oldest open invoice. Null when every invoice is paid.
 */
export function suggestedAmountOf(
  invoices: readonly LedgerInvoice[],
  today: string,
): MinorUnits | null {
  const owed = invoices
    .filter((invoice) => invoice.dueDate <= today)
    .reduce((sum, invoice) => sum + invoice.amountDue, 0);
  if (owed > 0) return owed;
  return unpaidOf(invoices)[0]?.amountDue ?? null;
}
