import { describe, expect, it } from "vitest";
import { type ReferralInput, referralDiscounts } from "./referral";

const NEW_MEMBER = "11111111-1111-4111-8111-111111111111";
const REFERRER = "22222222-2222-4222-8222-222222222222";

const input = (settings: Partial<ReferralInput["settings"]> = {}): ReferralInput => ({
  memberId: NEW_MEMBER,
  referrerId: REFERRER,
  startsOn: "2026-11-16",
  settings: {
    referrerAmount: 1000,
    referrerIsRecurring: true,
    referredAmount: 500,
    referredIsRecurring: false,
    ...settings,
  },
});

describe("referralDiscounts", () => {
  it("makes one discount for the referrer and one for the new member from the defaults", () => {
    expect(referralDiscounts(input())).toEqual({
      ok: true,
      value: [
        {
          memberId: REFERRER,
          sourceMemberId: NEW_MEMBER,
          side: "referrer",
          amount: 1000,
          isRecurring: true,
          startsOn: "2026-11-16",
        },
        {
          memberId: NEW_MEMBER,
          sourceMemberId: REFERRER,
          side: "referred",
          amount: 500,
          isRecurring: false,
          startsOn: "2026-11-16",
        },
      ],
    });
  });

  it("makes no row for a side whose default is zero", () => {
    const onlyReferrer = referralDiscounts(input({ referredAmount: 0 }));
    expect(onlyReferrer.ok && onlyReferrer.value.map((row) => row.side)).toEqual(["referrer"]);
    const onlyReferred = referralDiscounts(input({ referrerAmount: 0 }));
    expect(onlyReferred.ok && onlyReferred.value.map((row) => row.side)).toEqual(["referred"]);
    expect(referralDiscounts(input({ referrerAmount: 0, referredAmount: 0 }))).toEqual({
      ok: true,
      value: [],
    });
  });

  it("copies the amounts, so a later change to the defaults cannot reach a row made before", () => {
    const settings = { ...input().settings };
    const made = referralDiscounts({ ...input(), settings });
    settings.referrerAmount = 9999;
    expect(made.ok && made.value[0]?.amount).toBe(1000);
  });

  it("refuses a member who refers themselves", () => {
    const result = referralDiscounts({ ...input(), referrerId: NEW_MEMBER });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "validation",
        message: "Invalid referral",
        issues: [{ path: ["referredBy"], message: "A member cannot refer themselves" }],
      },
    });
  });
});
