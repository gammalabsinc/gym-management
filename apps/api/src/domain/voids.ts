import { type ValidationError, validationError } from "./errors";
import { parseReason } from "./membership";
import { type Allocation, allocateOldestFirst, type UnpaidInvoice } from "./payment";
import { ok, type Result } from "./result";
import { parseUuid } from "./uuid";

/** What the owner types on the void sheet of a payment. */
export interface VoidPaymentInput {
  readonly paymentId: string;
  readonly reason: string;
}

export interface VoidInvoiceInput {
  readonly invoiceId: string;
  readonly reason: string;
}

export interface NewVoid {
  /** The id of the payment or invoice to void. */
  readonly id: string;
  readonly reason: string;
}

/** Checks the id and the reason of a void. Every problem is reported. */
function parseVoid(
  rawId: string,
  field: "paymentId" | "invoiceId",
  rawReason: string,
): Result<NewVoid, ValidationError> {
  const id = parseUuid(rawId, field);
  const reason = parseReason(rawReason);
  if (id.ok && reason.ok) return ok({ id: id.value, reason: reason.value });
  return validationError("Invalid void", [
    ...(id.ok ? [] : id.error.issues),
    ...(reason.ok ? [] : reason.error.issues),
  ]);
}

export function parseVoidPayment(input: VoidPaymentInput): Result<NewVoid, ValidationError> {
  return parseVoid(input.paymentId, "paymentId", input.reason);
}

export function parseVoidInvoice(input: VoidInvoiceInput): Result<NewVoid, ValidationError> {
  return parseVoid(input.invoiceId, "invoiceId", input.reason);
}

/** Part of a payment that no invoice has used. It is the member's credit. */
export interface SpareCredit {
  readonly paymentId: string;
  /** More than zero. */
  readonly remainder: number;
}

export interface CreditAllocation extends Allocation {
  readonly paymentId: string;
}

/**
 * Puts the credit that is left on payments towards the invoices that are open again, oldest
 * payment first and oldest invoice first, each as far as the money goes. No allocation is more
 * than the invoice is owed or than the payment has left.
 */
export function reallocateCredit(
  credits: readonly SpareCredit[],
  unpaid: readonly UnpaidInvoice[],
): readonly CreditAllocation[] {
  let open = unpaid;
  const placed: CreditAllocation[] = [];
  for (const credit of credits) {
    const settled = allocateOldestFirst(credit.remainder, open);
    for (const allocation of settled.allocations) {
      placed.push({ paymentId: credit.paymentId, ...allocation });
    }
    open = open
      .map((invoice) => {
        const used = settled.allocations.find((a) => a.invoiceId === invoice.invoiceId);
        return used === undefined
          ? invoice
          : { ...invoice, amountDue: invoice.amountDue - used.amount };
      })
      .filter((invoice) => invoice.amountDue > 0);
  }
  return placed;
}
