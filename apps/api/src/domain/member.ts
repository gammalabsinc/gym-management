import { daysBetween, isCalendarDate } from "./calendar";
import { isEmailAddress, normalizeEmail } from "./email";
import { type FieldIssue, type ValidationError, validationError } from "./errors";
import { ok, type Result } from "./result";
import { parseUuid } from "./uuid";

export const MAX_MEMBER_NAME_LENGTH = 120;
/** Older members come in through the backfill script, so one new member never builds a long run of invoices. */
export const MAX_BACKDATE_DAYS = 366;

/** Member numbers and barcodes are six characters, uppercase letters and digits. */
export const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const CODE_LENGTH = 6;
/** Tries to find a free pair of codes. The unique indexes are the judge, this only bounds the loop. */
export const MAX_CODE_ATTEMPTS = 5;

const PHONE_PATTERN = /^\+?[0-9 ()\-.]{6,24}$/;

export function isMemberCode(value: string): boolean {
  return value.length === CODE_LENGTH && [...value].every((char) => CODE_ALPHABET.includes(char));
}

/** What staff type on the add member screen. */
export interface NewMemberInput {
  readonly fullName: string;
  readonly email: string;
  readonly phone?: string | null | undefined;
  /** The day the membership starts, written YYYY-MM-DD. */
  readonly joinDate: string;
  /** The id of the member who referred this one. */
  readonly referredBy?: string | null | undefined;
}

export interface NewMember {
  readonly fullName: string;
  /** Lower case, the way users are stored. */
  readonly email: string;
  readonly phone: string | null;
  readonly joinDate: string;
  readonly referredBy: string | null;
  /** The day of the month every cycle starts, taken from the join date. */
  readonly billingDay: number;
}

function nameIssues(name: string): FieldIssue[] {
  if (name === "") return [{ path: ["fullName"], message: "Required" }];
  if (name.length > MAX_MEMBER_NAME_LENGTH) {
    return [{ path: ["fullName"], message: `At most ${MAX_MEMBER_NAME_LENGTH} characters` }];
  }
  return [];
}

function joinDateIssues(joinDate: string, today: string): FieldIssue[] {
  if (!isCalendarDate(joinDate)) {
    return [{ path: ["joinDate"], message: "Enter a real date written YYYY-MM-DD" }];
  }
  const daysAgo = daysBetween(joinDate, today);
  if (daysAgo < 0) return [{ path: ["joinDate"], message: "Cannot be in the future" }];
  if (daysAgo > MAX_BACKDATE_DAYS) {
    return [{ path: ["joinDate"], message: `Cannot be more than ${MAX_BACKDATE_DAYS} days ago` }];
  }
  return [];
}

/**
 * Checks a new member and puts it in the form it is stored in. `today` is the gym's local date, so
 * "in the future" means the gym's calendar and not the server's. Every problem is reported.
 */
export function parseNewMember(
  input: NewMemberInput,
  today: string,
): Result<NewMember, ValidationError> {
  const fullName = input.fullName.trim();
  const email = normalizeEmail(input.email);
  const phone = input.phone?.trim() ?? "";
  const joinDate = input.joinDate.trim();
  const referral = input.referredBy == null ? null : parseUuid(input.referredBy, "referredBy");
  const issues = [
    ...nameIssues(fullName),
    ...(isEmailAddress(email) ? [] : [{ path: ["email"], message: "Enter a valid email address" }]),
    ...(phone === "" || PHONE_PATTERN.test(phone)
      ? []
      : [{ path: ["phone"], message: "Enter a valid phone number" }]),
    ...joinDateIssues(joinDate, today),
    ...(referral !== null && !referral.ok ? referral.error.issues : []),
  ];
  if (issues.length > 0) return validationError("Invalid member", issues);
  return ok({
    fullName,
    email,
    phone: phone === "" ? null : phone,
    joinDate,
    referredBy: referral?.ok ? referral.value : null,
    billingDay: Number(joinDate.slice(8, 10)),
  });
}
