import type { NotFoundError, ValidationError } from "../domain/errors";
import { MAX_AHEAD_CYCLES } from "../domain/invoice-build";
import type { MinorUnits } from "../domain/money";
import { type Allocation, allocateOldestFirst } from "../domain/payment";
import { ok, type Result } from "../domain/result";
import { generateInvoicesInUnit, type InvoiceContext, peekNextInvoice } from "./invoices";
import type { Clock, PaymentUnit } from "./ports";

export interface PaymentSettlement {
  /** The invoices the payment settles, oldest first. */
  readonly allocations: readonly Allocation[];
  /** The part of the payment that settles nothing. It is the member's credit. */
  readonly credit: MinorUnits;
}

/**
 * Decides what a payment covers. Invoices that are due by today are built, then the payment
 * settles the oldest unpaid invoice first, each as far as the money goes. When every unpaid invoice
 * is settled and money is left, the next cycles are built ahead, up to 12, and settled in turn
 * while the money covers a whole one. What is left stays as credit and no invoice is built for it.
 *
 * Recording a payment and previewing one both run this, so they cannot disagree. It writes only
 * through `unit`, which is the real unit when recording and one that keeps its writes in memory
 * when previewing. The caller has locked the member.
 */
export async function settlePayment(
  unit: PaymentUnit,
  clock: Clock,
  billing: InvoiceContext,
  request: { readonly memberId: string; readonly amount: MinorUnits },
): Promise<Result<PaymentSettlement, ValidationError | NotFoundError>> {
  const due = await generateInvoicesInUnit(
    unit,
    clock,
    { memberId: request.memberId, ahead: 0 },
    billing,
  );
  if (!due.ok) return due;

  const unpaid = await unit.payments.unpaidInvoices(request.memberId);
  const first = allocateOldestFirst(request.amount, unpaid);
  const allocations = [...first.allocations];
  let credit = first.remainder;
  for (let step = 0; step < MAX_AHEAD_CYCLES && credit > 0; step += 1) {
    const next = await peekNextInvoice(unit, clock, request.memberId);
    if (!next.ok) return next;
    if (next.value === null || next.value.total > credit) break;
    const built = await generateInvoicesInUnit(
      unit,
      clock,
      { memberId: request.memberId, ahead: next.value.ahead },
      billing,
    );
    if (!built.ok) return built;
    for (const invoice of built.value.invoices) {
      // An invoice that a discount took to zero is paid already and needs no allocation.
      if (invoice.total > 0) allocations.push({ invoiceId: invoice.id, amount: invoice.total });
      credit -= invoice.total;
    }
  }
  return ok({ allocations, credit });
}
