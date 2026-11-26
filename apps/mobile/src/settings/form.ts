import { formatMoney } from "../ui/money";
import { formatMoneyInput, parseMoneyInput, parseWholeNumber } from "./money-input";
import type { SettingsData, SettingsPatch } from "./service";

export type FieldKey =
  | "admissionFee"
  | "monthlyFee"
  | "referrerAmount"
  | "referredAmount"
  | "warnDaysBefore"
  | "redDaysAfter"
  | "dupWindowMin";

export const FIELD_KEYS: readonly FieldKey[] = [
  "admissionFee",
  "monthlyFee",
  "referrerAmount",
  "referredAmount",
  "warnDaysBefore",
  "redDaysAfter",
  "dupWindowMin",
];

/** What the inputs hold: text for the fields, booleans for the repeat switches. */
export interface Form {
  readonly admissionFee: string;
  readonly monthlyFee: string;
  readonly referrerAmount: string;
  readonly referrerIsRecurring: boolean;
  readonly referredAmount: string;
  readonly referredIsRecurring: boolean;
  readonly warnDaysBefore: string;
  readonly redDaysAfter: string;
  readonly dupWindowMin: string;
}

export type Errors = Partial<Record<FieldKey, string>>;

const MAX_DAYS = 365;
const MAX_MINUTES = 1440;

export function toForm(data: SettingsData): Form {
  return {
    admissionFee: formatMoneyInput(data.admissionFee, data.currency),
    monthlyFee: formatMoneyInput(data.monthlyFee, data.currency),
    referrerAmount: formatMoneyInput(data.referrerAmount, data.currency),
    referrerIsRecurring: data.referrerIsRecurring,
    referredAmount: formatMoneyInput(data.referredAmount, data.currency),
    referredIsRecurring: data.referredIsRecurring,
    warnDaysBefore: String(data.warnDaysBefore),
    redDaysAfter: String(data.redDaysAfter),
    dupWindowMin: String(data.dupWindowMin),
  };
}

export const FEE_KEYS = ["admissionFee", "monthlyFee"] as const;

export function feesChanged(a: Form, b: Form): boolean {
  return FEE_KEYS.some((key) => a[key].trim() !== b[key].trim());
}

export function settingsChanged(a: Form, b: Form): boolean {
  return (
    (
      [
        "referrerAmount",
        "referredAmount",
        "warnDaysBefore",
        "redDaysAfter",
        "dupWindowMin",
      ] as const
    ).some((key) => a[key].trim() !== b[key].trim()) ||
    a.referrerIsRecurring !== b.referrerIsRecurring ||
    a.referredIsRecurring !== b.referredIsRecurring
  );
}

export function isDirty(a: Form, b: Form): boolean {
  return feesChanged(a, b) || settingsChanged(a, b);
}

export type Validated =
  | {
      readonly ok: true;
      readonly fees: { readonly admissionFee: number; readonly monthlyFee: number };
      readonly settings: SettingsPatch;
    }
  | { readonly ok: false; readonly errors: Errors };

/** Turns the typed values into integer minor units and whole numbers, or says which field is wrong. */
export function validate(form: Form, currency: string): Validated {
  const errors: Errors = {};
  const money = (key: "admissionFee" | "monthlyFee" | "referrerAmount" | "referredAmount") => {
    const parsed = parseMoneyInput(form[key], currency);
    if (!parsed.ok) errors[key] = parsed.error;
    return parsed.ok ? parsed.minor : 0;
  };
  const whole = (key: "warnDaysBefore" | "redDaysAfter" | "dupWindowMin", max: number) => {
    const parsed = parseWholeNumber(form[key], max);
    if (!parsed.ok) errors[key] = parsed.error;
    return parsed.ok ? parsed.minor : 0;
  };
  const admissionFee = money("admissionFee");
  const monthlyFee = money("monthlyFee");
  const referrerAmount = money("referrerAmount");
  const referredAmount = money("referredAmount");
  const warnDaysBefore = whole("warnDaysBefore", MAX_DAYS);
  const redDaysAfter = whole("redDaysAfter", MAX_DAYS);
  const dupWindowMin = whole("dupWindowMin", MAX_MINUTES);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    fees: { admissionFee, monthlyFee },
    settings: {
      warnDaysBefore,
      redDaysAfter,
      dupWindowMin,
      referrerAmount,
      referrerIsRecurring: form.referrerIsRecurring,
      referredAmount,
      referredIsRecurring: form.referredIsRecurring,
    },
  };
}

/** The sentence under the referral inputs, in the words of the design. */
export function referralPreview(form: Form, currency: string): string | null {
  const referrer = parseMoneyInput(form.referrerAmount, currency);
  const referred = parseMoneyInput(form.referredAmount, currency);
  if (!referrer.ok || !referred.ok) return null;
  const a = formatMoney(referrer.minor, currency);
  const b = formatMoney(referred.minor, currency);
  const referrerPart = form.referrerIsRecurring
    ? `${a} off every month while the new member stays active`
    : `${a} off their next invoice`;
  const referredPart = form.referredIsRecurring
    ? `${b} off every month`
    : `${b} off their first month`;
  return `The referrer gets ${referrerPart}. The new member gets ${referredPart}.`;
}

/** The server names a field like `input.admissionFee`. Only the last part matters here. */
export function fieldOf(name: string | null): FieldKey | null {
  if (name === null) return null;
  const last = name.split(".").pop() ?? name;
  return FIELD_KEYS.find((key) => key === last) ?? null;
}
