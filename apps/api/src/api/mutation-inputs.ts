import { z } from "zod";
import {
  boundedText,
  dateSchema,
  emailSchema,
  idSchema,
  LIMITS,
  minorUnitsSchema,
  optional,
  phoneSchema,
  positiveMinorUnitsSchema,
  urlSchema,
} from "./input";

// The closed sets mirror the enums in schema.graphql. inputs.test.ts fails tsc if they drift.
export const ROLES = ["OWNER", "STAFF", "MEMBER"] as const;
export const MEMBER_STATUSES = ["ACTIVE", "PAUSED", "CANCELLED"] as const;
export const PAYMENT_METHODS = ["CASH", "CARD", "BANK_TRANSFER"] as const;
export const SCAN_SOURCES = ["STAFF_APP", "MANUAL"] as const;

const roleSchema = z.enum(ROLES);
const memberStatusSchema = z.enum(MEMBER_STATUSES);
const paymentMethodSchema = z.enum(PAYMENT_METHODS);
const scanSourceSchema = z.enum(SCAN_SOURCES);

const reasonSchema = boundedText(LIMITS.reason);
const daysSchema = z.number().int().min(0).max(LIMITS.maxDays);

/** Staff may only invite owners and staff. Members are created with createMember. */
const invitableRoleSchema = roleSchema.exclude(["MEMBER"]);

// One schema per input object. strict() turns an unknown field into an error, which is how an
// attempt to change a member's email through updateMember is refused.
export const memberInput = z
  .object({
    name: boundedText(LIMITS.name),
    email: emailSchema,
    phone: optional(phoneSchema),
    photoRef: optional(boundedText(LIMITS.photoRef)),
    planId: idSchema,
    joinedOn: dateSchema,
    referredById: optional(idSchema),
  })
  .strict();

export const memberPatch = z
  .object({
    name: optional(boundedText(LIMITS.name)),
    phone: optional(phoneSchema),
    photoRef: optional(boundedText(LIMITS.photoRef)),
    status: optional(memberStatusSchema),
    reason: optional(reasonSchema),
  })
  .strict();

export const recordPaymentInput = z
  .object({
    clientRequestId: idSchema,
    memberId: idSchema,
    amount: positiveMinorUnitsSchema,
    method: paymentMethodSchema,
    paidOn: optional(dateSchema),
    proofLink: optional(urlSchema),
  })
  .strict();

export const discountInput = z
  .object({
    memberId: idSchema,
    amount: positiveMinorUnitsSchema,
    isRecurring: z.boolean(),
    reason: reasonSchema,
    startsOn: optional(dateSchema),
  })
  .strict();

export const planInput = z
  .object({
    name: boundedText(LIMITS.name),
    admissionFee: minorUnitsSchema,
    monthlyFee: minorUnitsSchema,
  })
  .strict();

export const settingsInput = z
  .object({
    warnDaysBefore: optional(daysSchema),
    redDaysAfter: optional(daysSchema),
    dupWindowMin: optional(z.number().int().min(0).max(LIMITS.maxMinutesInDay)),
    referrerAmount: optional(minorUnitsSchema),
    referrerIsRecurring: optional(z.boolean()),
    referredAmount: optional(minorUnitsSchema),
    referredIsRecurring: optional(z.boolean()),
  })
  .strict();

/** Arguments of each mutation, keyed by mutation name. A resolver parses its args with its entry. */
export const mutationArgs = {
  signIn: z.object({ idToken: boundedText(LIMITS.idToken) }).strict(),
  signOut: z.object({}).strict(),
  selectGym: z.object({ tenantId: idSchema }).strict(),
  recordScan: z
    .object({
      barcode: boundedText(LIMITS.barcode),
      source: scanSourceSchema.nullish().transform((value) => value ?? "STAFF_APP"),
    })
    .strict(),
  createMember: z.object({ input: memberInput }).strict(),
  updateMember: z.object({ id: idSchema, patch: memberPatch }).strict(),
  recordPayment: z.object({ input: recordPaymentInput }).strict(),
  voidPayment: z.object({ id: idSchema, reason: reasonSchema }).strict(),
  voidInvoice: z.object({ id: idSchema, reason: reasonSchema }).strict(),
  addDiscount: z.object({ input: discountInput }).strict(),
  endDiscount: z.object({ id: idSchema, reason: reasonSchema }).strict(),
  updatePlan: z.object({ id: idSchema, input: planInput }).strict(),
  updateSettings: z.object({ input: settingsInput }).strict(),
  inviteUser: z
    .object({
      email: emailSchema,
      name: optional(boundedText(LIMITS.name)),
      role: invitableRoleSchema,
    })
    .strict(),
  setRole: z.object({ userId: idSchema, role: roleSchema, isOn: z.boolean() }).strict(),
} as const;
