import {
  type ConflictError,
  conflict,
  type NotFoundError,
  notFound,
  type ValidationError,
  validationError,
} from "../domain/errors";
import {
  type NewReferralDiscount,
  type ReferralInput,
  referralDiscounts,
} from "../domain/referral";
import { ok, type Result } from "../domain/result";
import type { AuditLog, ReferralStore } from "./ports";

export const DISCOUNT_CREATED = "discount.created";
export const ALREADY_REFERRED_MESSAGE = "This referral was already applied";

/** Everything applying a referral needs, all inside one tenant transaction. */
export interface ReferralUnit {
  readonly referrals: ReferralStore;
  readonly audit: AuditLog;
}

export interface ReferralRequest extends ReferralInput {
  /** The person who added the member. A job has no actor. */
  readonly actorUserId: string | null;
  readonly requestId: string;
}

export interface AppliedReferral {
  /** The discounts written, the referrer's first. Empty when both defaults are zero. */
  readonly discounts: readonly (NewReferralDiscount & { readonly id: string })[];
}

type ReferralError = ValidationError | NotFoundError | ConflictError;

/**
 * Applies a referral inside the caller's transaction, so the discounts commit or roll back with
 * the member they belong to. The rows come from the gym's defaults as they are now and keep their
 * own amounts. A member cannot refer themselves, the referrer is the one captured when the member
 * was added and cannot be another, and the same referral is never applied twice, so a second
 * referral for one new member is refused. One audit event per discount.
 */
export async function applyReferral(
  unit: ReferralUnit,
  request: ReferralRequest,
): Promise<Result<AppliedReferral, ReferralError>> {
  const drafts = referralDiscounts(request);
  if (!drafts.ok) return drafts;
  const captured = await unit.referrals.referrerOf(request.memberId);
  if (captured === undefined) return notFound("Member not found");
  if (captured !== request.referrerId) {
    return validationError("Invalid referral", [
      { path: ["referredBy"], message: "The referrer of a member cannot change" },
    ]);
  }
  if (await unit.referrals.exists(request.memberId, request.referrerId)) {
    return conflict(ALREADY_REFERRED_MESSAGE);
  }
  const discounts: (NewReferralDiscount & { readonly id: string })[] = [];
  for (const draft of drafts.value) {
    const id = await unit.referrals.insert({ ...draft, createdBy: request.actorUserId });
    // The referral was just found missing in this transaction, so a refused row is a bug.
    if (id === null) throw new Error("A referral discount that did not exist was refused");
    await unit.audit.record({
      actorUserId: request.actorUserId,
      action: DISCOUNT_CREATED,
      entityType: "discount",
      entityId: id,
      before: null,
      after: {
        memberId: draft.memberId,
        sourceMemberId: draft.sourceMemberId,
        side: draft.side,
        amount: draft.amount,
        isRecurring: draft.isRecurring,
        startsOn: draft.startsOn,
      },
      requestId: request.requestId,
    });
    discounts.push({ ...draft, id });
  }
  return ok({ discounts });
}
