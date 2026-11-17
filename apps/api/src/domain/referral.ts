import { type ValidationError, validationError } from "./errors";
import { ok, type Result } from "./result";
import type { TenantSettings } from "./tenant";

export type ReferralSide = "referrer" | "referred";

/** The part of the gym settings a referral reads. */
export type ReferralSettings = Pick<
  TenantSettings,
  "referrerAmount" | "referrerIsRecurring" | "referredAmount" | "referredIsRecurring"
>;

export interface ReferralInput {
  /** The new member, who was referred. */
  readonly memberId: string;
  /** The member who referred them. */
  readonly referrerId: string;
  /** The first day the discounts can land on an invoice, the day the new member joined. */
  readonly startsOn: string;
  /** The gym's defaults as they are now. Later changes never reach rows made from them. */
  readonly settings: ReferralSettings;
}

/** One discount row a referral makes. `memberId` is who receives it, `sourceMemberId` the other person. */
export interface NewReferralDiscount {
  readonly memberId: string;
  readonly sourceMemberId: string;
  readonly side: ReferralSide;
  /** Flat minor units, more than zero. */
  readonly amount: number;
  /** False means one time. */
  readonly isRecurring: boolean;
  readonly startsOn: string;
}

/**
 * The discounts a referral makes from the gym's defaults: one for the referrer and one for the new
 * member, each only when its amount is more than zero. The amounts are copied into the rows, so
 * changing the defaults later does not rewrite a discount that exists. A member cannot refer
 * themselves.
 */
export function referralDiscounts(
  input: ReferralInput,
): Result<readonly NewReferralDiscount[], ValidationError> {
  const { memberId, referrerId, startsOn, settings } = input;
  if (memberId === referrerId) {
    return validationError("Invalid referral", [
      { path: ["referredBy"], message: "A member cannot refer themselves" },
    ]);
  }
  const rows: NewReferralDiscount[] = [
    {
      memberId: referrerId,
      sourceMemberId: memberId,
      side: "referrer",
      amount: settings.referrerAmount,
      isRecurring: settings.referrerIsRecurring,
      startsOn,
    },
    {
      memberId,
      sourceMemberId: referrerId,
      side: "referred",
      amount: settings.referredAmount,
      isRecurring: settings.referredIsRecurring,
      startsOn,
    },
  ];
  return ok(rows.filter((row) => row.amount > 0));
}
