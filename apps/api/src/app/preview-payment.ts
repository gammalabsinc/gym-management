import { localDateIn } from "../domain/calendar";
import {
  type NotFoundError,
  notFound,
  type ValidationError,
  validationError,
} from "../domain/errors";
import type { MinorUnits } from "../domain/money";
import {
  applyAllocations,
  type PreviewPaymentInput,
  paidThroughOf,
  parsePreviewPayment,
  suggestedAmountOf,
} from "../domain/payment";
import { ok, type Result } from "../domain/result";
import { type DryPaymentUnit, makeDryPaymentUnit } from "./dry-payment-unit";
import { generateInvoicesInUnit, type InvoiceContext, peekNextInvoice } from "./invoices";
import { settlePayment } from "./payment-allocation";
import type { Clock, PaymentUnit, WithTenantTx } from "./ports";
import { type PermissionContext, requirePermission } from "./require-permission";

export interface PreviewPaymentDeps {
  readonly withUnit: WithTenantTx<PaymentUnit>;
  readonly clock: Clock;
}

/** The tenant, the caller and the request all come from the session, never from client input. */
export interface PreviewPaymentContext extends PermissionContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly requestId: string;
}

export interface PreviewAllocation {
  /** Null for an invoice that does not exist yet and would be built by the payment. */
  readonly invoiceId: string | null;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly amount: MinorUnits;
}

export interface PaymentPreview {
  /** The amount that was previewed: the one asked for, or the suggested one. */
  readonly amount: MinorUnits;
  /** What to prefill: what the member owes, else the oldest open invoice, else the next one. */
  readonly suggestedAmount: MinorUnits | null;
  /** The invoices the payment would settle, oldest first. */
  readonly allocations: readonly PreviewAllocation[];
  /** The last day covered once the payment is in. Null when nothing would be paid up. */
  readonly paidThroughAfter: string | null;
  /** What would be left over as credit. */
  readonly creditAfter: MinorUnits;
}

type PreviewError = ValidationError | NotFoundError;

/** The amount the screen should start with, worked out on a ledger that has the due invoices in it. */
async function suggestAmount(
  dry: DryPaymentUnit,
  deps: PreviewPaymentDeps,
  today: string,
  memberId: string,
): Promise<Result<MinorUnits | null, PreviewError>> {
  const fromLedger = suggestedAmountOf(dry.ledger(), today);
  if (fromLedger !== null) return ok(fromLedger);
  const next = await peekNextInvoice(dry.unit, deps.clock, memberId);
  if (!next.ok) return next;
  return ok(next.value !== null && next.value.total > 0 ? next.value.total : null);
}

/** The allocations with the cycle each one settles, in the order of the ledger, oldest first. */
function describe(
  dry: DryPaymentUnit,
  allocations: readonly { readonly invoiceId: string; readonly amount: MinorUnits }[],
): readonly PreviewAllocation[] {
  return dry.ledger().flatMap((invoice) => {
    const allocation = allocations.find((item) => item.invoiceId === invoice.invoiceId);
    return allocation === undefined
      ? []
      : [
          {
            invoiceId: dry.isBuilt(invoice.invoiceId) ? null : invoice.invoiceId,
            periodStart: invoice.periodStart,
            periodEnd: invoice.periodEnd,
            amount: allocation.amount,
          },
        ];
  });
}

/**
 * Shows what a payment would do, and writes nothing. It runs the same settling code as recording a
 * payment, on a unit that keeps its writes in memory, so the two cannot give different allocations
 * for the same ledger. With no amount it previews the suggested one. Staff only, like recording.
 */
export function makePreviewPayment(deps: PreviewPaymentDeps) {
  return requirePermission<
    PreviewPaymentInput,
    PreviewPaymentContext,
    PaymentPreview,
    PreviewError
  >("payment.record", async (input, ctx) => {
    const parsed = parsePreviewPayment(input);
    if (!parsed.ok) return parsed;
    return deps.withUnit(
      ctx.tenantId,
      async (unit): Promise<Result<PaymentPreview, PreviewError>> => {
        const tenant = await unit.tenants.find();
        if (tenant === null) throw new Error("The gym of this transaction cannot be read");
        const member = await unit.invoices.lockMember(parsed.value.memberId);
        if (member === null) return notFound("Member not found");

        const ledger = await unit.payments.ledger(member.id);
        const billing: InvoiceContext = {
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          requestId: ctx.requestId,
        };

        const owing = makeDryPaymentUnit(unit, ledger);
        const due = await generateInvoicesInUnit(
          owing.unit,
          deps.clock,
          { memberId: member.id, ahead: 0 },
          billing,
        );
        if (!due.ok) return due;
        const today = localDateIn(deps.clock.now(), tenant.timezone);
        const suggested = await suggestAmount(owing, deps, today, member.id);
        if (!suggested.ok) return suggested;

        const amount = parsed.value.amount ?? suggested.value;
        if (amount === null) {
          return validationError("Nothing is due", [
            { path: ["amount"], message: "Nothing is due, enter an amount" },
          ]);
        }

        const paying = makeDryPaymentUnit(unit, ledger);
        const settled = await settlePayment(paying.unit, deps.clock, billing, {
          memberId: member.id,
          amount,
        });
        if (!settled.ok) return settled;
        const { allocations, credit } = settled.value;
        return ok({
          amount,
          suggestedAmount: suggested.value,
          allocations: describe(paying, allocations),
          paidThroughAfter: paidThroughOf(applyAllocations(paying.ledger(), allocations)),
          creditAfter: credit,
        });
      },
    );
  });
}
