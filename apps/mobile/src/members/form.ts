import type { FieldProblem, NewMember, ProfilePatch, Referrer } from "./service";

export type FieldKey = "name" | "email" | "phone" | "joinedOn";

export const FIELD_KEYS: readonly FieldKey[] = ["name", "email", "phone", "joinedOn"];

export interface Form {
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly joinedOn: string;
  readonly referrer: Referrer | null;
}

export type Errors = Partial<Record<FieldKey, string>>;

export const NAME_MAX = 120;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[\d\s().-]{7,20}$/;

export const EMPTY_FORM: Form = { name: "", email: "", phone: "", joinedOn: "", referrer: null };

/** Today's calendar date in the gym's time zone, as `2026-12-13`. */
export function todayIn(timezone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts;
}

/** A real calendar date like `2026-02-28`. `2026-02-30` is not one. */
export function isCalendarDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function checkName(text: string, errors: Errors): string {
  const name = text.trim();
  if (name === "") errors.name = "Enter the member's full name.";
  else if (name.length > NAME_MAX) errors.name = `Use ${NAME_MAX} characters or fewer.`;
  return name;
}

function checkPhone(text: string, errors: Errors): string | null {
  const phone = text.trim();
  if (phone === "") return null;
  if (!PHONE_PATTERN.test(phone)) errors.phone = "Enter a phone number, like 416 555 0100.";
  return phone;
}

export type Validated<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: Errors };

function finish<T>(errors: Errors, value: T): Validated<T> {
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

/** Add: every typed value is checked here before any request is made. */
export function validateNew(form: Form, planId: string): Validated<NewMember> {
  const errors: Errors = {};
  const name = checkName(form.name, errors);
  const email = form.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) errors.email = "Enter the member's Google email.";
  const phone = checkPhone(form.phone, errors);
  const joinedOn = form.joinedOn.trim();
  if (!isCalendarDate(joinedOn)) errors.joinedOn = "Enter a date like 2026-12-13.";
  return finish(errors, {
    name,
    email,
    phone,
    planId,
    joinedOn,
    referredById: form.referrer?.id ?? null,
  });
}

/** Edit: only the name and phone can change. */
export function validateEdit(form: Form): Validated<ProfilePatch> {
  const errors: Errors = {};
  const name = checkName(form.name, errors);
  const phone = checkPhone(form.phone, errors);
  return finish(errors, { name, phone });
}

export function editChanged(a: Form, b: Form): boolean {
  return a.name.trim() !== b.name.trim() || a.phone.trim() !== b.phone.trim();
}

export function newChanged(a: Form, b: Form): boolean {
  return (
    editChanged(a, b) ||
    a.email.trim() !== b.email.trim() ||
    a.joinedOn.trim() !== b.joinedOn.trim() ||
    a.referrer?.id !== b.referrer?.id
  );
}

export interface InvoicePreview {
  readonly admission: number;
  readonly monthly: number;
  readonly total: number;
  readonly dueOn: string;
}

/** The first invoice: an admission line and the monthly line, due on the join date. Fees come from the API. */
export function invoicePreview(
  fees: { readonly admissionFee: number; readonly monthlyFee: number },
  joinedOn: string,
): InvoicePreview | null {
  const dueOn = joinedOn.trim();
  if (!isCalendarDate(dueOn)) return null;
  return {
    admission: fees.admissionFee,
    monthly: fees.monthlyFee,
    total: fees.admissionFee + fees.monthlyFee,
    dueOn,
  };
}

export interface PlacedProblems {
  readonly errors: Errors;
  readonly general: string | null;
}

/** The server names a field like `input.email`. Only the last part matters here. */
export function fieldOf(name: string | null): FieldKey | null {
  if (name === null) return null;
  const last = name.split(".").pop() ?? name;
  return FIELD_KEYS.find((key) => key === last) ?? null;
}

/**
 * Puts each server problem on its field. A conflict with no field is the duplicate email, which the
 * design shows on the email field. Anything else with no field is shown above the Save button.
 */
export function placeProblems(problems: readonly FieldProblem[]): PlacedProblems {
  const errors: Errors = {};
  let general: string | null = null;
  for (const problem of problems) {
    const key = fieldOf(problem.field) ?? (problem.code === "CONFLICT" ? "email" : null);
    if (key === null) general = problem.message;
    else errors[key] = problem.message;
  }
  return { errors, general };
}
