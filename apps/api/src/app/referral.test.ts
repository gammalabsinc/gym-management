import { describe, expect, it } from "vitest";
import type { AuditEvent, NewReferralRow } from "./ports";
import {
  ALREADY_REFERRED_MESSAGE,
  applyReferral,
  DISCOUNT_CREATED,
  type ReferralUnit,
} from "./referral";

const MEMBER = "11111111-1111-4111-8111-111111111111";
const REFERRER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const ACTOR = "44444444-4444-4444-8444-444444444444";

const SETTINGS = {
  referrerAmount: 1000,
  referrerIsRecurring: true,
  referredAmount: 500,
  referredIsRecurring: false,
};

const REQUEST = {
  memberId: MEMBER,
  referrerId: REFERRER,
  startsOn: "2026-11-16",
  settings: SETTINGS,
  actorUserId: ACTOR,
  requestId: "req-1",
};

interface Options {
  /** What the member row says. Undefined means the gym has no such member. */
  captured?: string | null | undefined;
  exists?: boolean;
  /** Each insert answers from this list; a null is a refused row. */
  inserts?: (string | null)[];
}

function setup(options: Options = {}) {
  const reads: string[] = [];
  const rows: NewReferralRow[] = [];
  const audit: AuditEvent[] = [];
  const answers = [...(options.inserts ?? ["discount-1", "discount-2"])];
  const unit: ReferralUnit = {
    referrals: {
      referrerOf: async () => {
        reads.push("referrerOf");
        return "captured" in options ? options.captured : REFERRER;
      },
      exists: async () => {
        reads.push("exists");
        return options.exists ?? false;
      },
      insert: async (row) => {
        rows.push(row);
        return answers.shift() ?? null;
      },
    },
    audit: {
      record: async (event) => {
        audit.push(event);
      },
    },
  };
  return { unit, reads, rows, audit };
}

describe("applyReferral", () => {
  it("writes the discounts from the defaults, referrer first, with an audit event each", async () => {
    const { unit, rows, audit } = setup();
    const result = await applyReferral(unit, REQUEST);
    expect(result).toEqual({
      ok: true,
      value: {
        discounts: [
          expect.objectContaining({ id: "discount-1", side: "referrer", amount: 1000 }),
          expect.objectContaining({ id: "discount-2", side: "referred", amount: 500 }),
        ],
      },
    });
    expect(rows.map((row) => [row.memberId, row.sourceMemberId, row.createdBy])).toEqual([
      [REFERRER, MEMBER, ACTOR],
      [MEMBER, REFERRER, ACTOR],
    ]);
    expect(audit).toEqual([
      expect.objectContaining({
        actorUserId: ACTOR,
        action: DISCOUNT_CREATED,
        entityType: "discount",
        entityId: "discount-1",
        before: null,
        requestId: "req-1",
        after: expect.objectContaining({ side: "referrer", amount: 1000, isRecurring: true }),
      }),
      expect.objectContaining({ entityId: "discount-2" }),
    ]);
  });

  it("writes nothing, and succeeds, when both defaults are zero", async () => {
    const { unit, rows, audit } = setup();
    const settings = { ...SETTINGS, referrerAmount: 0, referredAmount: 0 };
    expect(await applyReferral(unit, { ...REQUEST, settings })).toEqual({
      ok: true,
      value: { discounts: [] },
    });
    expect(rows).toEqual([]);
    expect(audit).toEqual([]);
  });

  it("records no actor for a job", async () => {
    const { unit, rows } = setup();
    await applyReferral(unit, { ...REQUEST, actorUserId: null });
    expect(rows.every((row) => row.createdBy === null)).toBe(true);
  });

  it("refuses a self referral before reading anything", async () => {
    const { unit, reads, rows } = setup();
    const result = await applyReferral(unit, { ...REQUEST, referrerId: MEMBER });
    expect(result).toMatchObject({ ok: false, error: { kind: "validation" } });
    expect(reads).toEqual([]);
    expect(rows).toEqual([]);
  });

  it("answers not found for a member the gym does not have", async () => {
    const { unit, rows } = setup({ captured: undefined });
    expect(await applyReferral(unit, REQUEST)).toEqual({
      ok: false,
      error: { kind: "not_found", message: "Member not found" },
    });
    expect(rows).toEqual([]);
  });

  it("refuses a second referral from someone other than the captured referrer", async () => {
    const { unit, rows } = setup();
    const result = await applyReferral(unit, { ...REQUEST, referrerId: OTHER });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "validation", issues: [{ path: ["referredBy"] }] },
    });
    expect(rows).toEqual([]);
  });

  it("refuses a referral for a member nobody referred", async () => {
    const { unit, rows } = setup({ captured: null });
    expect(await applyReferral(unit, REQUEST)).toMatchObject({
      ok: false,
      error: { kind: "validation" },
    });
    expect(rows).toEqual([]);
  });

  it("refuses the same referral twice", async () => {
    const { unit, rows } = setup({ exists: true });
    expect(await applyReferral(unit, REQUEST)).toEqual({
      ok: false,
      error: { kind: "conflict", message: ALREADY_REFERRED_MESSAGE },
    });
    expect(rows).toEqual([]);
  });

  it("throws, to roll back, when the database refuses a row it was just told was missing", async () => {
    const { unit } = setup({ inserts: ["discount-1", null] });
    await expect(applyReferral(unit, REQUEST)).rejects.toThrow("was refused");
  });
});
