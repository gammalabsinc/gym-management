import type { InvoiceDue } from "./standing";

/**
 * What a member's invoice list shows. Unpaid is owing and already due, upcoming is generated but
 * not yet due, paid is settled in full, and voided wins over everything else.
 */
export const INVOICE_STATUSES = ["unpaid", "upcoming", "paid", "voided"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** True when the invoice is live and still has an amount to pay. Standing reads the same rule. */
export function isOwing(invoice: Pick<InvoiceDue, "isVoid" | "amountDue">): boolean {
  return !invoice.isVoid && invoice.amountDue > 0;
}

/**
 * The one place an invoice's status is decided, so the list on the customer screen and the
 * standing of the member agree. `today` is the gym's local date, written YYYY-MM-DD.
 */
export function invoiceStatusOf(invoice: InvoiceDue, today: string): InvoiceStatus {
  if (invoice.isVoid) return "voided";
  if (!isOwing(invoice)) return "paid";
  return invoice.dueDate > today ? "upcoming" : "unpaid";
}
