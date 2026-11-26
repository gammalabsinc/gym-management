import type {
  DiscountInput,
  MemberInput,
  MemberPatch,
  MemberStatus,
  Mutation,
  MutationAddDiscountArgs,
  MutationCreateMemberArgs,
  MutationEndDiscountArgs,
  MutationInviteUserArgs,
  MutationRecordPaymentArgs,
  MutationRecordScanArgs,
  MutationRemoveAccessArgs,
  MutationSelectGymArgs,
  MutationSetRoleArgs,
  MutationSignInArgs,
  MutationUpdateMemberArgs,
  MutationUpdatePlanArgs,
  MutationUpdateSettingsArgs,
  MutationVoidInvoiceArgs,
  MutationVoidPaymentArgs,
  PaymentMethod,
  PlanInput,
  RecordPaymentInput,
  Role,
  ScanSource,
  SettingsInput,
} from "@gym/graphql-schema";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import { LIMITS } from "./input";
import {
  discountInput,
  type MEMBER_STATUSES,
  memberInput,
  memberPatch,
  mutationArgs,
  type PAYMENT_METHODS,
  planInput,
  type ROLES,
  recordPaymentInput,
  type SCAN_SOURCES,
  settingsInput,
} from "./mutation-inputs";

type Keys<S extends z.ZodType> = keyof z.input<S>;

describe("schemas stay in step with schema.graphql (checked by tsc)", () => {
  it("covers every mutation exactly once", () => {
    expectTypeOf<keyof typeof mutationArgs>().toEqualTypeOf<
      Exclude<keyof Mutation, "__typename">
    >();
    expect(Object.keys(mutationArgs)).toHaveLength(16);
  });

  it("has the same fields as every input object", () => {
    expectTypeOf<Keys<typeof memberInput>>().toEqualTypeOf<keyof MemberInput>();
    expectTypeOf<Keys<typeof memberPatch>>().toEqualTypeOf<keyof MemberPatch>();
    expectTypeOf<Keys<typeof recordPaymentInput>>().toEqualTypeOf<keyof RecordPaymentInput>();
    expectTypeOf<Keys<typeof discountInput>>().toEqualTypeOf<keyof DiscountInput>();
    expectTypeOf<Keys<typeof planInput>>().toEqualTypeOf<keyof PlanInput>();
    expectTypeOf<Keys<typeof settingsInput>>().toEqualTypeOf<keyof SettingsInput>();
  });

  it("has the same arguments as every mutation", () => {
    expectTypeOf<Keys<typeof mutationArgs.signIn>>().toEqualTypeOf<keyof MutationSignInArgs>();
    expectTypeOf<Keys<typeof mutationArgs.selectGym>>().toEqualTypeOf<
      keyof MutationSelectGymArgs
    >();
    expectTypeOf<Keys<typeof mutationArgs.recordScan>>().toEqualTypeOf<
      keyof MutationRecordScanArgs
    >();
    expectTypeOf<Keys<typeof mutationArgs.createMember>>().toEqualTypeOf<
      keyof MutationCreateMemberArgs
    >();
    expectTypeOf<Keys<typeof mutationArgs.updateMember>>().toEqualTypeOf<
      keyof MutationUpdateMemberArgs
    >();
    expectTypeOf<Keys<typeof mutationArgs.recordPayment>>().toEqualTypeOf<
      keyof MutationRecordPaymentArgs
    >();
    expectTypeOf<Keys<typeof mutationArgs.voidPayment>>().toEqualTypeOf<
      keyof MutationVoidPaymentArgs
    >();
    expectTypeOf<Keys<typeof mutationArgs.voidInvoice>>().toEqualTypeOf<
      keyof MutationVoidInvoiceArgs
    >();
    expectTypeOf<Keys<typeof mutationArgs.addDiscount>>().toEqualTypeOf<
      keyof MutationAddDiscountArgs
    >();
    expectTypeOf<Keys<typeof mutationArgs.endDiscount>>().toEqualTypeOf<
      keyof MutationEndDiscountArgs
    >();
    expectTypeOf<Keys<typeof mutationArgs.updatePlan>>().toEqualTypeOf<
      keyof MutationUpdatePlanArgs
    >();
    expectTypeOf<Keys<typeof mutationArgs.updateSettings>>().toEqualTypeOf<
      keyof MutationUpdateSettingsArgs
    >();
    expectTypeOf<Keys<typeof mutationArgs.inviteUser>>().toEqualTypeOf<
      keyof MutationInviteUserArgs
    >();
    expectTypeOf<Keys<typeof mutationArgs.setRole>>().toEqualTypeOf<keyof MutationSetRoleArgs>();
    expectTypeOf<Keys<typeof mutationArgs.removeAccess>>().toEqualTypeOf<
      keyof MutationRemoveAccessArgs
    >();
  });

  it("lists exactly the values of each closed set", () => {
    expectTypeOf<(typeof ROLES)[number]>().toEqualTypeOf<Role>();
    expectTypeOf<(typeof MEMBER_STATUSES)[number]>().toEqualTypeOf<MemberStatus>();
    expectTypeOf<(typeof PAYMENT_METHODS)[number]>().toEqualTypeOf<PaymentMethod>();
    expectTypeOf<(typeof SCAN_SOURCES)[number]>().toEqualTypeOf<ScanSource>();
  });
});

const validMember = {
  name: "Sam Lee",
  email: "Sam@Example.com",
  planId: "plan_1",
  joinedOn: "2026-11-14",
};
const validPayment = {
  clientRequestId: "req-1",
  memberId: "m1",
  amount: 4500,
  method: "CASH",
};
const validDiscount = { memberId: "m1", amount: 500, isRecurring: false, reason: "Loyalty" };

const ok = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;

describe("memberInput", () => {
  it("accepts a valid member, normalises the email and treats null as absent", () => {
    expect(memberInput.parse({ ...validMember, phone: null })).toEqual({
      ...validMember,
      email: "sam@example.com",
      phone: undefined,
      photoRef: undefined,
      referredById: undefined,
    });
  });

  it("rejects oversized strings", () => {
    expect(ok(memberInput, { ...validMember, name: "n".repeat(LIMITS.name + 1) })).toBe(false);
    expect(ok(memberInput, { ...validMember, photoRef: "p".repeat(LIMITS.photoRef + 1) })).toBe(
      false,
    );
  });

  it("rejects a malformed join date and a bad email", () => {
    expect(ok(memberInput, { ...validMember, joinedOn: "2026-02-30" })).toBe(false);
    expect(ok(memberInput, { ...validMember, joinedOn: "14-11-2026" })).toBe(false);
    expect(ok(memberInput, { ...validMember, email: "nope" })).toBe(false);
  });

  it("rejects fields that are not part of the input", () => {
    expect(ok(memberInput, { ...validMember, memberNo: "M-1" })).toBe(false);
  });
});

describe("memberPatch", () => {
  it("accepts the allowed fields", () => {
    expect(ok(memberPatch, { name: "New Name", status: "PAUSED", reason: "Travel" })).toBe(true);
    expect(ok(memberPatch, {})).toBe(true);
  });

  it("refuses an email change and unknown statuses", () => {
    expect(ok(memberPatch, { email: "other@example.com" })).toBe(false);
    expect(ok(memberPatch, { status: "DELETED" })).toBe(false);
  });

  it("rejects an oversized reason", () => {
    expect(ok(memberPatch, { reason: "r".repeat(LIMITS.reason + 1) })).toBe(false);
  });
});

describe("recordPaymentInput", () => {
  it("accepts a valid payment with an optional date and proof link", () => {
    expect(
      ok(recordPaymentInput, {
        ...validPayment,
        paidOn: "2026-11-01",
        proofLink: "https://x.test/p",
      }),
    ).toBe(true);
    expect(ok(recordPaymentInput, validPayment)).toBe(true);
  });

  it("rejects zero, negative and fractional amounts", () => {
    for (const amount of [0, -1, -4500, 12.5]) {
      expect(ok(recordPaymentInput, { ...validPayment, amount })).toBe(false);
    }
  });

  it("rejects a malformed paid on date, an unknown method and a script link", () => {
    expect(ok(recordPaymentInput, { ...validPayment, paidOn: "2026-13-01" })).toBe(false);
    expect(ok(recordPaymentInput, { ...validPayment, method: "CRYPTO" })).toBe(false);
    expect(ok(recordPaymentInput, { ...validPayment, proofLink: "javascript:alert(1)" })).toBe(
      false,
    );
  });

  it("requires the client request id that makes the payment idempotent", () => {
    const { clientRequestId: _omitted, ...rest } = validPayment;
    expect(ok(recordPaymentInput, rest)).toBe(false);
  });
});

describe("discountInput", () => {
  it("accepts a valid discount", () => {
    expect(ok(discountInput, validDiscount)).toBe(true);
    expect(ok(discountInput, { ...validDiscount, startsOn: "2026-12-01" })).toBe(true);
  });

  it("rejects a non positive amount, a blank reason and a bad start date", () => {
    expect(ok(discountInput, { ...validDiscount, amount: 0 })).toBe(false);
    expect(ok(discountInput, { ...validDiscount, amount: -50 })).toBe(false);
    expect(ok(discountInput, { ...validDiscount, reason: "   " })).toBe(false);
    expect(ok(discountInput, { ...validDiscount, startsOn: "soon" })).toBe(false);
  });
});

describe("planInput", () => {
  it("accepts zero fees and rejects negative ones", () => {
    expect(ok(planInput, { name: "Standard", admissionFee: 0, monthlyFee: 4000 })).toBe(true);
    expect(ok(planInput, { name: "Standard", admissionFee: -1, monthlyFee: 4000 })).toBe(false);
    expect(ok(planInput, { name: "Standard", admissionFee: 0, monthlyFee: -4000 })).toBe(false);
  });

  it("rejects an oversized or blank name", () => {
    expect(
      ok(planInput, { name: "p".repeat(LIMITS.name + 1), admissionFee: 0, monthlyFee: 1 }),
    ).toBe(false);
    expect(ok(planInput, { name: " ", admissionFee: 0, monthlyFee: 1 })).toBe(false);
  });
});

describe("settingsInput", () => {
  it("accepts a partial update", () => {
    expect(ok(settingsInput, { warnDaysBefore: 3, referrerIsRecurring: true })).toBe(true);
    expect(ok(settingsInput, {})).toBe(true);
  });

  it("rejects negative amounts and out of range days and minutes", () => {
    expect(ok(settingsInput, { referrerAmount: -1 })).toBe(false);
    expect(ok(settingsInput, { referredAmount: -1 })).toBe(false);
    expect(ok(settingsInput, { warnDaysBefore: -1 })).toBe(false);
    expect(ok(settingsInput, { redDaysAfter: LIMITS.maxDays + 1 })).toBe(false);
    expect(ok(settingsInput, { dupWindowMin: LIMITS.maxMinutesInDay + 1 })).toBe(false);
  });
});

describe("mutationArgs", () => {
  it("defaults the scan source and trims the barcode", () => {
    expect(mutationArgs.recordScan.parse({ barcode: " AB12CD " })).toEqual({
      barcode: "AB12CD",
      source: "STAFF_APP",
    });
    expect(mutationArgs.recordScan.parse({ barcode: "AB12CD", source: null }).source).toBe(
      "STAFF_APP",
    );
    expect(mutationArgs.recordScan.parse({ barcode: "AB12CD", source: "MANUAL" }).source).toBe(
      "MANUAL",
    );
  });

  it("rejects a blank or oversized barcode and an unknown source", () => {
    expect(ok(mutationArgs.recordScan, { barcode: " " })).toBe(false);
    expect(ok(mutationArgs.recordScan, { barcode: "b".repeat(LIMITS.barcode + 1) })).toBe(false);
    expect(ok(mutationArgs.recordScan, { barcode: "AB12CD", source: "QR" })).toBe(false);
  });

  it("validates nested inputs through the wrapper args", () => {
    expect(ok(mutationArgs.createMember, { input: validMember })).toBe(true);
    expect(ok(mutationArgs.createMember, { input: { ...validMember, joinedOn: "nope" } })).toBe(
      false,
    );
    expect(ok(mutationArgs.recordPayment, { input: { ...validPayment, amount: -1 } })).toBe(false);
    expect(ok(mutationArgs.addDiscount, { input: validDiscount })).toBe(true);
    expect(ok(mutationArgs.updateMember, { id: "m1", patch: { name: "A" } })).toBe(true);
    expect(
      ok(mutationArgs.updatePlan, {
        id: "p1",
        input: { name: "A", admissionFee: 1, monthlyFee: 1 },
      }),
    ).toBe(true);
    expect(ok(mutationArgs.updateSettings, { input: { dupWindowMin: 5 } })).toBe(true);
  });

  it("takes a bounded Google ID token to sign in and nothing to sign out", () => {
    expect(mutationArgs.signIn.parse({ idToken: " a.b.c " })).toEqual({ idToken: "a.b.c" });
    expect(ok(mutationArgs.signIn, { idToken: " " })).toBe(false);
    expect(ok(mutationArgs.signIn, { idToken: "t".repeat(LIMITS.idToken + 1) })).toBe(false);
    expect(ok(mutationArgs.signIn, { idToken: "a.b.c", extra: 1 })).toBe(false);
    expect(ok(mutationArgs.signOut, {})).toBe(true);
    expect(ok(mutationArgs.signOut, { token: "x" })).toBe(false);
  });

  it("requires a reason, within the limit, to void or end anything", () => {
    for (const name of ["voidPayment", "voidInvoice", "endDiscount"] as const) {
      expect(ok(mutationArgs[name], { id: "x1", reason: "Duplicate entry" })).toBe(true);
      expect(ok(mutationArgs[name], { id: "x1", reason: "" })).toBe(false);
      expect(ok(mutationArgs[name], { id: "x1", reason: "r".repeat(LIMITS.reason + 1) })).toBe(
        false,
      );
    }
  });

  it("only lets owners and staff be invited, and any role be set", () => {
    expect(ok(mutationArgs.inviteUser, { email: "a@b.co", role: "STAFF" })).toBe(true);
    expect(ok(mutationArgs.inviteUser, { email: "a@b.co", role: "OWNER", name: "Ann" })).toBe(true);
    expect(ok(mutationArgs.inviteUser, { email: "a@b.co", role: "MEMBER" })).toBe(false);
    expect(ok(mutationArgs.setRole, { userId: "u1", role: "MEMBER", isOn: true })).toBe(true);
    expect(ok(mutationArgs.setRole, { userId: "u1", role: "ROOT", isOn: true })).toBe(false);
    expect(ok(mutationArgs.removeAccess, { userId: "u1" })).toBe(true);
    expect(ok(mutationArgs.removeAccess, { userId: "" })).toBe(false);
    expect(ok(mutationArgs.removeAccess, { userId: "u1", extra: 1 })).toBe(false);
    expect(ok(mutationArgs.selectGym, { tenantId: "t1" })).toBe(true);
    expect(ok(mutationArgs.selectGym, { tenantId: "" })).toBe(false);
  });

  it("rejects missing arguments and arguments of the wrong type", () => {
    expect(ok(mutationArgs.selectGym, {})).toBe(false);
    expect(ok(mutationArgs.setRole, { userId: "u1", role: "STAFF", isOn: "yes" })).toBe(false);
    expect(ok(mutationArgs.createMember, null)).toBe(false);
  });
});
