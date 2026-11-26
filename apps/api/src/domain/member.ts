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

export function nameIssues(name: string, field = "fullName"): FieldIssue[] {
  if (name === "") return [{ path: [field], message: "Required" }];
  if (name.length > MAX_MEMBER_NAME_LENGTH) {
    return [{ path: [field], message: `At most ${MAX_MEMBER_NAME_LENGTH} characters` }];
  }
  return [];
}

export function phoneIssues(phone: string): FieldIssue[] {
  return phone === "" || PHONE_PATTERN.test(phone)
    ? []
    : [{ path: ["phone"], message: "Enter a valid phone number" }];
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
    ...phoneIssues(phone),
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

/** The only fields an edit may change. Everything else about a member is fixed after it is added. */
export const EDITABLE_PROFILE_FIELDS = ["name", "phone", "photoRef"] as const;

/** Photos live in the bucket under the gym's own id, so a reference can only name an object of this gym. */
const PHOTO_OBJECT_PATTERN =
  /^members\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/;

/** The key of a member photo in the bucket: the gym id, then members/, then the object id and type. */
export function photoRefIssues(ref: string, tenantId: string): FieldIssue[] {
  const prefix = `${tenantId}/`;
  const valid = ref.startsWith(prefix) && PHOTO_OBJECT_PATTERN.test(ref.slice(prefix.length));
  return valid
    ? []
    : [
        {
          path: ["photoRef"],
          message: "Must be a photo of this gym, ending in .jpg, .png or .webp",
        },
      ];
}

/** What staff type on the edit member screen. Fields outside the allow list are refused. */
export interface MemberProfileEditInput {
  readonly memberId: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** The fields that were sent, in the form they are stored in. A null phone clears it. */
export interface ProfileChange {
  readonly name?: string;
  readonly phone?: string | null;
  /** The bucket key of the photo. A null photo reference removes the photo. */
  readonly photoRef?: string | null;
}

export interface ParsedProfileEdit {
  readonly memberId: string;
  readonly change: ProfileChange;
}

function stringField(value: unknown, field: string): Result<string, ValidationError> {
  return typeof value === "string"
    ? ok(value.trim())
    : validationError("Invalid member", [{ path: [field], message: "Must be text" }]);
}

function parseNameChange(value: unknown): Result<string, ValidationError> {
  const text = stringField(value, "name");
  if (!text.ok) return text;
  const issues = nameIssues(text.value, "name");
  return issues.length > 0 ? validationError("Invalid member", issues) : text;
}

function parsePhoneChange(value: unknown): Result<string | null, ValidationError> {
  if (value === null) return ok(null);
  const text = stringField(value, "phone");
  if (!text.ok) return text;
  const issues = phoneIssues(text.value);
  if (issues.length > 0) return validationError("Invalid member", issues);
  return ok(text.value === "" ? null : text.value);
}

function parsePhotoRefChange(
  value: unknown,
  tenantId: string,
): Result<string | null, ValidationError> {
  if (value === null) return ok(null);
  const text = stringField(value, "photoRef");
  if (!text.ok) return text;
  if (text.value === "") return ok(null);
  const issues = photoRefIssues(text.value, tenantId);
  return issues.length > 0 ? validationError("Invalid member", issues) : text;
}

/**
 * Checks an edit against the allow list. A field outside the list, such as member_no, barcode or
 * email, is reported and nothing is written. Every problem is reported, and an edit with no
 * allowed field in it is refused.
 */
export function parseProfileEdit(
  input: MemberProfileEditInput,
  tenantId: string,
): Result<ParsedProfileEdit, ValidationError> {
  const memberId = parseUuid(input.memberId, "memberId");
  const sent = Object.keys(input.fields).filter((key) => input.fields[key] !== undefined);
  const issues: FieldIssue[] = [
    ...(memberId.ok ? [] : memberId.error.issues),
    ...sent
      .filter((key) => !(EDITABLE_PROFILE_FIELDS as readonly string[]).includes(key))
      .map((key) => ({ path: [key], message: "Cannot be changed" })),
    ...(sent.length === 0 ? [{ path: [], message: "Nothing to change" }] : []),
  ];
  const name = sent.includes("name") ? parseNameChange(input.fields.name) : undefined;
  const phone = sent.includes("phone") ? parsePhoneChange(input.fields.phone) : undefined;
  const photoRef = sent.includes("photoRef")
    ? parsePhotoRefChange(input.fields.photoRef, tenantId)
    : undefined;
  if (name?.ok === false) issues.push(...name.error.issues);
  if (phone?.ok === false) issues.push(...phone.error.issues);
  if (photoRef?.ok === false) issues.push(...photoRef.error.issues);
  if (issues.length > 0 || !memberId.ok) return validationError("Invalid member", issues);
  return ok({
    memberId: memberId.value,
    change: {
      ...(name?.ok ? { name: name.value } : {}),
      ...(phone?.ok ? { phone: phone.value } : {}),
      ...(photoRef?.ok ? { photoRef: photoRef.value } : {}),
    },
  });
}
