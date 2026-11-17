import { localDateIn } from "../domain/calendar";
import {
  type ConflictError,
  conflict,
  type NotFoundError,
  notFound,
  type ValidationError,
} from "../domain/errors";
import type { MinorUnits } from "../domain/money";
import {
  type Allocation,
  type PaymentMethod,
  parseRecordPayment,
  type RecordPaymentInput,
} from "../domain/payment";
import { ok, type Result } from "../domain/result";
import { settlePayment } from "./payment-allocation";
import type { Clock, PaymentUnit, StoredPayment, WithTenantTx } from "./ports";
import { type PermissionContext, requirePermission } from "./require-permission";

export const PAYMENT_RECORDED = "payment.recorded";
export const REQUEST_ID_REUSED_MESSAGE = "This request id was already used for another member";

export interface RecordPaymentDeps {
  readonly withUnit: WithTenantTx<PaymentUnit>;
  readonly clock: Clock;
}

/** The tenant, the caller and the request all come from the session, never from client input. */
export interface RecordPaymentContext extends PermissionContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly requestId: string;
}

export interface RecordedPayment {
  readonly id: string;
  readonly memberId: string;
  readonly amount: MinorUnits;
  readonly method: PaymentMethod;
  readonly paidOn: string;
  readonly submittedAt: string;
  readonly proofLink: string | null;
  readonly recordedBy: string;
  readonly isVoid: boolean;
  readonly voidReason: string | null;
  /** The invoices the payment settled, oldest first. */
  readonly allocations: readonly Allocation[];
  /** The part of the payment that settled nothing. It is the member's credit. */
  readonly credit: MinorUnits;
  /** True when the request id had been recorded before, so this call wrote nothing. */
  readonly replayed: boolean;
}

type RecordError = ValidationError | NotFoundError | ConflictError;

function sumOf(allocations: readonly Allocation[]): MinorUnits {
  return allocations.reduce((total, allocation) => total + allocation.amount, 0);
}

function present(payment: StoredPayment, replayed: boolean): RecordedPayment {
  return { ...payment, credit: payment.amount - sumOf(payment.allocations), replayed };
}

/**
 * Records money received from a member and lets the server decide what it covers. The member row
 * is locked first, so two payments for one member take turns, and the request id is looked up
 * after the lock, so a retry that raced the first call finds it and writes nothing. Invoices that
 * are due by today are built, then the payment settles the oldest unpaid invoice first, each as
 * far as the money goes. When every unpaid invoice is settled and money is left, the next cycles
 * are built ahead, up to 12, and settled in turn while the money covers a whole one. What is left
 * stays as credit and no invoice is built for it. The payment, its allocations, the invoices
 * built and the audit events commit together or not at all.
 */
export function makeRecordPayment(deps: RecordPaymentDeps) {
  return requirePermission<RecordPaymentInput, RecordPaymentContext, RecordedPayment, RecordError>(
    "payment.record",
    (input, ctx) =>
      deps.withUnit(ctx.tenantId, async (unit): Promise<Result<RecordedPayment, RecordError>> => {
        const tenant = await unit.tenants.find();
        if (tenant === null) throw new Error("The gym of this transaction cannot be read");
        const parsed = parseRecordPayment(input, localDateIn(deps.clock.now(), tenant.timezone));
        if (!parsed.ok) return parsed;
        const payment = parsed.value;

        const member = await unit.invoices.lockMember(payment.memberId);
        if (member === null) return notFound("Member not found");
        const earlier = await unit.payments.findByRequestId(payment.clientRequestId);
        if (earlier !== null) {
          return earlier.memberId === payment.memberId
            ? ok(present(earlier, true))
            : conflict(REQUEST_ID_REUSED_MESSAGE);
        }
        const stored = await unit.payments.insert({ ...payment, recordedBy: ctx.userId });
        // Another member's payment took the request id between the lookup and the insert.
        if (stored === null) return conflict(REQUEST_ID_REUSED_MESSAGE);

        const settled = await settlePayment(
          unit,
          deps.clock,
          { tenantId: ctx.tenantId, actorUserId: ctx.userId, requestId: ctx.requestId },
          { memberId: member.id, amount: payment.amount },
        );
        if (!settled.ok) return settled;
        const { allocations, credit } = settled.value;
        await unit.payments.insertAllocations(stored.id, allocations);
        await unit.audit.record({
          actorUserId: ctx.userId,
          action: PAYMENT_RECORDED,
          entityType: "payment",
          entityId: stored.id,
          before: null,
          after: {
            memberId: member.id,
            amount: payment.amount,
            method: payment.method,
            paidOn: payment.paidOn,
            invoices: allocations.length,
            credit,
          },
          requestId: ctx.requestId,
        });
        return ok({
          id: stored.id,
          memberId: member.id,
          amount: payment.amount,
          method: payment.method,
          paidOn: payment.paidOn,
          submittedAt: stored.submittedAt,
          proofLink: payment.proofLink,
          recordedBy: ctx.userId,
          isVoid: false,
          voidReason: null,
          allocations,
          credit,
          replayed: false,
        });
      }),
  );
}
