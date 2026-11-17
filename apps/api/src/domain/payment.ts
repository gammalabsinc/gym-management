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
