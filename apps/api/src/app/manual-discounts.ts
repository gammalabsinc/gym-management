import { localDateIn } from "../domain/calendar";
import {
  type ConflictError,
  conflict,
  type NotFoundError,
  notFound,
  type ValidationError,
} from "../domain/errors";
import {
  ALREADY_ENDED_MESSAGE,
  endDateFor,
  type ManualDiscountInput,
  parseEndDiscount,
  parseManualDiscount,
} from "../domain/manual-discount";
import { ok, type Result } from "../domain/result";
import type { Clock, DiscountUnit, WithTenantTx } from "./ports";
import { type PermissionContext, requirePermission } from "./require-permission";

export const DISCOUNT_ADDED = "discount.added";
export const DISCOUNT_ENDED = "discount.ended";

export interface ManualDiscountDeps {
  readonly withUnit: WithTenantTx<DiscountUnit>;
  readonly clock: Clock;
}

/** The tenant, the caller and the request all come from the session, never from client input. */
export interface ManualDiscountContext extends PermissionContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly requestId: string;
}

export interface AddedDiscount {
  readonly id: string;
  readonly memberId: string;
  readonly amount: number;
  readonly isRecurring: boolean;
  /** The first day a cycle can start on and still get the discount. */
  readonly startsOn: string;
}

export interface EndedDiscount {
  readonly id: string;
  readonly memberId: string;
  readonly endsOn: string;
}

type DiscountError = ValidationError | NotFoundError | ConflictError;

/** The gym's local date, which is the day a change takes effect. */
async function gymToday(unit: DiscountUnit, clock: Clock): Promise<string> {
  const tenant = await unit.tenants.find();
  if (tenant === null) throw new Error("The gym of this transaction cannot be read");
  return localDateIn(clock.now(), tenant.timezone);
}

/**
 * Adds a manual discount to a member. Owners only, with a reason. It starts today by the gym's
 * calendar, so it reaches invoices generated for cycles from today on and never one that was
 * already generated. The member row is locked first so it takes turns with invoice generation.
 * The new row and its audit event commit together.
 */
export function makeAddManualDiscount(deps: ManualDiscountDeps) {
  return requirePermission<
    ManualDiscountInput,
    ManualDiscountContext,
    AddedDiscount,
    DiscountError
  >("discount.manage", async (input, ctx) => {
    const parsed = parseManualDiscount(input);
    if (!parsed.ok) return parsed;
    const { memberId, amount, isRecurring, reason } = parsed.value;
    return deps.withUnit(
      ctx.tenantId,
      async (unit): Promise<Result<AddedDiscount, DiscountError>> => {
        if ((await unit.invoices.lockMember(memberId)) === null) {
          return notFound("Member not found");
        }
        const startsOn = await gymToday(unit, deps.clock);
        const id = await unit.discounts.insertManual({
          memberId,
          amount,
          isRecurring,
          reason,
          startsOn,
          createdBy: ctx.userId,
        });
        await unit.audit.record({
          actorUserId: ctx.userId,
          action: DISCOUNT_ADDED,
          entityType: "member_discount",
          entityId: id,
          before: null,
          after: { memberId, kind: "manual", amount, isRecurring, reason, startsOn },
          requestId: ctx.requestId,
        });
        return ok({ id, memberId, amount, isRecurring, startsOn });
      },
    );
  });
}

/**
 * Ends a monthly discount. Owners only. Nothing is edited or deleted: the end date is set to
 * today by the gym's calendar, so invoices for cycles after today no longer get it and invoices
 * already generated keep what they have. A one time, already ended or not yet started discount is
 * refused. The change and its audit event commit together.
 */
export function makeEndDiscount(deps: ManualDiscountDeps) {
  return requirePermission<
    { readonly discountId: string },
    ManualDiscountContext,
    EndedDiscount,
    DiscountError
  >("discount.manage", async (input, ctx) => {
    const parsed = parseEndDiscount(input);
    if (!parsed.ok) return parsed;
    const id = parsed.value;
    return deps.withUnit(
      ctx.tenantId,
      async (unit): Promise<Result<EndedDiscount, DiscountError>> => {
        const found = await unit.discounts.find(id);
        if (found === null) return notFound("Discount not found");
        // Every change to a member's money takes the member row first, so read the discount again after.
        if ((await unit.invoices.lockMember(found.memberId)) === null) {
          throw new Error("The member of a discount cannot be read");
        }
        const discount = await unit.discounts.find(id);
        if (discount === null) throw new Error("A discount disappeared under its member lock");
        const endsOn = endDateFor(discount, await gymToday(unit, deps.clock));
        if (!endsOn.ok) return endsOn;
        if (!(await unit.discounts.end(id, endsOn.value))) {
          return conflict(ALREADY_ENDED_MESSAGE);
        }
        await unit.audit.record({
          actorUserId: ctx.userId,
          action: DISCOUNT_ENDED,
          entityType: "member_discount",
          entityId: id,
          before: { endsOn: discount.endsOn },
          after: { endsOn: endsOn.value, memberId: discount.memberId, amount: discount.amount },
          requestId: ctx.requestId,
        });
        return ok({ id, memberId: discount.memberId, endsOn: endsOn.value });
      },
    );
  });
}
