import {
  type ConflictError,
  conflict,
  type NotFoundError,
  notFound,
  type ValidationError,
} from "../domain/errors";
import type { Allocation } from "../domain/payment";
import { ok, type Result } from "../domain/result";
import {
  type CreditAllocation,
  parseVoidInvoice,
  parseVoidPayment,
  reallocateCredit,
  type VoidInvoiceInput,
  type VoidPaymentInput,
} from "../domain/voids";
import type { Clock, VoidDetails, VoidUnit, WithTenantTx } from "./ports";
import { type PermissionContext, requirePermission } from "./require-permission";

export const PAYMENT_VOIDED = "payment.voided";
export const INVOICE_VOIDED = "invoice.voided";
export const ALREADY_VOID_MESSAGE = "This is already void";
export const HAS_ALLOCATIONS_MESSAGE = "This invoice has payments applied, void the payment first";

export interface VoidDeps {
  readonly withUnit: WithTenantTx<VoidUnit>;
  readonly clock: Clock;
}

/** The tenant, the caller and the request all come from the session, never from client input. */
export interface VoidContext extends PermissionContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly requestId: string;
}

export interface VoidedPayment {
  readonly id: string;
  readonly memberId: string;
  readonly amount: number;
  readonly reason: string;
  /** The allocations of the payment. They stay on record and stop counting. */
  readonly reversed: readonly Allocation[];
  /** Credit that other payments held, now put towards the invoices this void opened again. */
  readonly reallocated: readonly CreditAllocation[];
}

export interface VoidedInvoice {
  readonly id: string;
  readonly memberId: string;
  readonly reason: string;
}

type VoidError = ValidationError | NotFoundError | ConflictError;

function detailsOf(reason: string, ctx: VoidContext, clock: Clock): VoidDetails {
  return { reason, voidedBy: ctx.userId, voidedAt: clock.now() };
}

/**
 * Voids a payment with a reason. Owners only. The member row is locked first, so a void and a new
 * payment for the same member take turns. The payment and its allocations stay on record, the
 * allocations stop counting, and so the invoices it paid are open again and standing follows.
 * Credit that other payments still hold is put towards those invoices, oldest first. A payment
 * cannot be voided twice. The void, the new allocations and the audit event commit together.
 */
export function makeVoidPayment(deps: VoidDeps) {
  return requirePermission<VoidPaymentInput, VoidContext, VoidedPayment, VoidError>(
    "payment.void",
    async (input, ctx) => {
      const parsed = parseVoidPayment(input);
      if (!parsed.ok) return parsed;
      const { id, reason } = parsed.value;
      return deps.withUnit(
        ctx.tenantId,
        async (unit): Promise<Result<VoidedPayment, VoidError>> => {
          const found = await unit.voids.findPayment(id);
          if (found === null) return notFound("Payment not found");
          // Every change to a member's money takes the member row first, so read the payment again after.
          const member = await unit.invoices.lockMember(found.memberId);
          if (member === null) throw new Error("The member of a payment cannot be read");
          const payment = await unit.voids.findPayment(id);
          if (payment === null) throw new Error("A payment disappeared under its member lock");
          if (payment.isVoid) return conflict(ALREADY_VOID_MESSAGE);

          const changed = await unit.voids.voidPayment(id, detailsOf(reason, ctx, deps.clock));
          if (!changed) return conflict(ALREADY_VOID_MESSAGE);

          const credits = await unit.voids.spareCredits(payment.memberId);
          const unpaid = await unit.payments.unpaidInvoices(payment.memberId);
          const reallocated = reallocateCredit(credits, unpaid);
          for (const credit of credits) {
            await unit.payments.insertAllocations(
              credit.paymentId,
              reallocated.filter((a) => a.paymentId === credit.paymentId),
            );
          }
          await unit.audit.record({
            actorUserId: ctx.userId,
            action: PAYMENT_VOIDED,
            entityType: "payment",
            entityId: id,
            before: { isVoid: false },
            after: {
              isVoid: true,
              reason,
              memberId: payment.memberId,
              amount: payment.amount,
              reversed: payment.allocations.length,
              reallocated: reallocated.length,
            },
            requestId: ctx.requestId,
          });
          return ok({
            id,
            memberId: payment.memberId,
            amount: payment.amount,
            reason,
            reversed: payment.allocations,
            reallocated,
          });
        },
      );
    },
  );
}

/**
 * Voids an invoice with a reason. Owners only. It is refused while payments are applied to it, so
 * the payment goes first. The invoice and its lines stay on record. An invoice cannot be voided
 * twice. The void and the audit event commit together.
 */
export function makeVoidInvoice(deps: VoidDeps) {
  return requirePermission<VoidInvoiceInput, VoidContext, VoidedInvoice, VoidError>(
    "invoice.void",
    async (input, ctx) => {
      const parsed = parseVoidInvoice(input);
      if (!parsed.ok) return parsed;
      const { id, reason } = parsed.value;
      return deps.withUnit(
        ctx.tenantId,
        async (unit): Promise<Result<VoidedInvoice, VoidError>> => {
          const found = await unit.voids.findInvoice(id);
          if (found === null) return notFound("Invoice not found");
          const member = await unit.invoices.lockMember(found.memberId);
          if (member === null) throw new Error("The member of an invoice cannot be read");
          const invoice = await unit.voids.findInvoice(id);
          if (invoice === null) throw new Error("An invoice disappeared under its member lock");
          if (invoice.isVoid) return conflict(ALREADY_VOID_MESSAGE);
          if (invoice.counted > 0) return conflict(HAS_ALLOCATIONS_MESSAGE);

          const changed = await unit.voids.voidInvoice(id, detailsOf(reason, ctx, deps.clock));
          if (!changed) return conflict(ALREADY_VOID_MESSAGE);
          await unit.audit.record({
            actorUserId: ctx.userId,
            action: INVOICE_VOIDED,
            entityType: "invoice",
            entityId: id,
            before: { isVoid: false },
            after: {
              isVoid: true,
              reason,
              memberId: invoice.memberId,
              periodStart: invoice.periodStart,
              total: invoice.total,
            },
            requestId: ctx.requestId,
          });
          return ok({ id, memberId: invoice.memberId, reason });
        },
      );
    },
  );
}
