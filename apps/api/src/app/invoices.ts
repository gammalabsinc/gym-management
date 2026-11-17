import type { DateText } from "../domain/billing-cycle";
import { addDays, localDateIn } from "../domain/calendar";
import type { Discount } from "../domain/discounts";
import { type NotFoundError, notFound, type ValidationError } from "../domain/errors";
import { buildInvoice, cyclesToGenerate, MAX_AHEAD_CYCLES } from "../domain/invoice-build";
import type { MinorUnits } from "../domain/money";
import { ok, type Result } from "../domain/result";
import { parseUuid } from "../domain/uuid";
import type { Clock, InvoiceUnit, WithTenantTx } from "./ports";

export interface InvoiceDeps {
  readonly withUnit: WithTenantTx<InvoiceUnit>;
  readonly clock: Clock;
}

/**
 * The gym comes from the session, or from a job. Another use case that calls this one passes its own
 * context on. A job has no actor.
 */
export interface InvoiceContext {
  readonly tenantId: string;
  readonly actorUserId: string | null;
  readonly requestId: string;
}

export interface GenerateInvoicesInput {
  readonly memberId: string;
  /** Cycles to build after the one that holds today, from 0 to 12. */
  readonly ahead: number;
}

export interface GeneratedInvoice {
  readonly id: string;
  readonly periodStart: DateText;
  readonly periodEnd: DateText;
  readonly total: MinorUnits;
}

export interface GeneratedInvoices {
  /** The invoices written by this run. Empty when nothing was due or the member is not active. */
  readonly invoices: readonly GeneratedInvoice[];
}

export const INVOICE_GENERATED = "invoice.generated";

type GenerateError = ValidationError | NotFoundError;

/** A one time discount that landed on an invoice cannot land on the next one of the same run. */
function withConsumed(
  discounts: readonly Discount[],
  consumedIds: readonly string[],
  invoiceId: string,
): readonly Discount[] {
  return discounts.map((discount) =>
    consumedIds.includes(discount.id) ? { ...discount, consumedInvoiceId: invoiceId } : discount,
  );
}

export interface GenerateInUnitInput {
  /** A member id that is already a valid uuid. */
  readonly memberId: string;
  readonly ahead: number;
  /**
   * Counts today this many days later, so a cycle that starts within that many days is built now.
   * The daily job passes the gym's warning window. Left out, it is today.
   */
  readonly lookAheadDays?: number | undefined;
}

/**
 * The body of invoice generation, for a caller that already holds the transaction, so the
 * invoices commit or roll back together with whatever else that caller wrote.
 */
export async function generateInvoicesInUnit(
  unit: InvoiceUnit,
  clock: Clock,
  input: GenerateInUnitInput,
  ctx: InvoiceContext,
): Promise<Result<GeneratedInvoices, GenerateError>> {
  const tenant = await unit.tenants.find();
  if (tenant === null) throw new Error("The gym of this transaction cannot be read");
  const member = await unit.invoices.lockMember(input.memberId);
  if (member === null) return notFound("Member not found");
  if (member.status !== "active") return ok({ invoices: [] });

  const fees = await unit.invoices.findPlanFees(member.planId);
  if (fees === null) throw new Error("The plan of a membership period cannot be read");
  const lastPeriodEnd = await unit.invoices.lastPeriodEnd(member.id);
  const cycles = cyclesToGenerate({
    billingDay: member.billingDay,
    activeFrom: member.activeFrom,
    lastPeriodEnd,
    today: addDays(localDateIn(clock.now(), tenant.timezone), input.lookAheadDays ?? 0),
    ahead: input.ahead,
  });
  if (!cycles.ok) return cycles;

  let discounts = await unit.invoices.discountsOf(member.id);
  let isFirst = lastPeriodEnd === null;
  const invoices: GeneratedInvoice[] = [];
  for (const cycle of cycles.value) {
    const draft = buildInvoice({ cycle, ...fees, isFirst, discounts });
    if (!draft.ok) return draft;
    const invoiceId = await unit.invoices.insert(member.id, draft.value);
    // A live invoice for this cycle exists already. Nothing was written, so nothing is used up.
    if (invoiceId === null) continue;
    isFirst = false;
    await unit.invoices.markConsumed(draft.value.consumedDiscountIds, invoiceId);
    discounts = withConsumed(discounts, draft.value.consumedDiscountIds, invoiceId);
    await unit.audit.record({
      actorUserId: ctx.actorUserId,
      action: INVOICE_GENERATED,
      entityType: "invoice",
      entityId: invoiceId,
      before: null,
      after: {
        memberId: member.id,
        periodStart: draft.value.periodStart,
        periodEnd: draft.value.periodEnd,
        total: draft.value.total,
        lines: draft.value.lines.length,
      },
      requestId: ctx.requestId,
    });
    invoices.push({
      id: invoiceId,
      periodStart: draft.value.periodStart,
      periodEnd: draft.value.periodEnd,
      total: draft.value.total,
    });
  }
  return ok({ invoices });
}

export interface NextInvoice {
  /** The `ahead` that makes generation build exactly this cycle, once everything up to today exists. */
  readonly ahead: number;
  readonly total: MinorUnits;
}

/**
 * The next invoice that generation would write for the member, with nothing written: how far
 * ahead of today it is and what it would total. Null when the member is not active or the next
 * cycle is more than 12 ahead. It reads the same rows the generation reads, so the total is the
 * one the invoice will get, and the caller holds the transaction that locked the member.
 */
export async function peekNextInvoice(
  unit: InvoiceUnit,
  clock: Clock,
  memberId: string,
): Promise<Result<NextInvoice | null, GenerateError>> {
  const tenant = await unit.tenants.find();
  if (tenant === null) throw new Error("The gym of this transaction cannot be read");
  const member = await unit.invoices.lockMember(memberId);
  if (member === null) return notFound("Member not found");
  if (member.status !== "active") return ok(null);
  const fees = await unit.invoices.findPlanFees(member.planId);
  if (fees === null) throw new Error("The plan of a membership period cannot be read");
  const lastPeriodEnd = await unit.invoices.lastPeriodEnd(member.id);
  const discounts = await unit.invoices.discountsOf(member.id);
  const today = localDateIn(clock.now(), tenant.timezone);
  for (let ahead = 0; ahead <= MAX_AHEAD_CYCLES; ahead += 1) {
    const cycles = cyclesToGenerate({
      billingDay: member.billingDay,
      activeFrom: member.activeFrom,
      lastPeriodEnd,
      today,
      ahead,
    });
    if (!cycles.ok) return cycles;
    const [cycle] = cycles.value;
    if (cycle === undefined) continue;
    const draft = buildInvoice({ cycle, ...fees, isFirst: lastPeriodEnd === null, discounts });
    if (!draft.ok) return draft;
    return ok({ ahead, total: draft.value.total });
  }
  return ok(null);
}

/**
 * Builds the next cycles of one member, up to 12 ahead, with the discount lines as they stand now.
 * Running it again builds nothing new, because the database allows one live invoice per member and
 * cycle. A paused or cancelled member gets no new invoices. The invoices, the used up one time
 * discounts and the audit events commit together or not at all.
 */
export function makeGenerateInvoices(deps: InvoiceDeps) {
  return async (
    input: GenerateInvoicesInput,
    ctx: InvoiceContext,
  ): Promise<Result<GeneratedInvoices, GenerateError>> => {
    const memberId = parseUuid(input.memberId, "memberId");
    if (!memberId.ok) return memberId;
    return deps.withUnit(ctx.tenantId, (unit) =>
      generateInvoicesInUnit(
        unit,
        deps.clock,
        { memberId: memberId.value, ahead: input.ahead },
        ctx,
      ),
    );
  };
}
