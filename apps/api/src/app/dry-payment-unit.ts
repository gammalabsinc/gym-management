import { type LedgerInvoice, unpaidOf } from "../domain/payment";
import type { PaymentUnit } from "./ports";

export interface DryPaymentUnit {
  /** A payment unit whose reads are the real ones and whose writes stay in memory. */
  readonly unit: PaymentUnit;
  /** The member's invoices with the ones built so far in this unit. */
  ledger(): readonly LedgerInvoice[];
  /** True for an invoice that exists only in this unit, so it has no id in the database. */
  isBuilt(invoiceId: string): boolean;
}

const BUILT_PREFIX = "preview:";

/**
 * Wraps a real unit so that settling a payment can run without writing. Invoices that settling
 * builds are kept in a list and show up in what it reads next, exactly as written rows would. The
 * payment itself, its allocations and the audit events are dropped, and a call that would write
 * a payment throws, because the settling code never makes one.
 */
export function makeDryPaymentUnit(
  real: PaymentUnit,
  ledger: readonly LedgerInvoice[],
): DryPaymentUnit {
  let invoices: readonly LedgerInvoice[] = ledger;
  let lastBuiltEnd: string | null = null;
  return {
    ledger: () => invoices,
    isBuilt: (invoiceId) => invoiceId.startsWith(BUILT_PREFIX),
    unit: {
      tenants: real.tenants,
      audit: { record: async () => {} },
      invoices: {
        lockMember: (memberId) => real.invoices.lockMember(memberId),
        findPlanFees: (planId) => real.invoices.findPlanFees(planId),
        discountsOf: (memberId) => real.invoices.discountsOf(memberId),
        lastPeriodEnd: async (memberId) => lastBuiltEnd ?? real.invoices.lastPeriodEnd(memberId),
        insert: async (_memberId, draft) => {
          const invoiceId = `${BUILT_PREFIX}${draft.periodStart}`;
          invoices = [
            ...invoices,
            {
              invoiceId,
              periodStart: draft.periodStart,
              periodEnd: draft.periodEnd,
              dueDate: draft.dueDate,
              amountDue: draft.total,
            },
          ];
          lastBuiltEnd = draft.periodEnd;
          return invoiceId;
        },
        markConsumed: async () => {},
      },
      payments: {
        findByRequestId: async () => null,
        unpaidInvoices: async () => unpaidOf(invoices),
        ledger: async () => invoices,
        insert: async () => {
          throw new Error("A preview cannot record a payment");
        },
        insertAllocations: async () => {
          throw new Error("A preview cannot record allocations");
        },
      },
    },
  };
}
