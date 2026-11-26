import { parseMoneyInput } from "../../settings/money-input";

/** A real calendar date, so 2026-02-30 is refused instead of rolling into March. */
export function isCalendarDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** The gym's local date for an instant, as `2026-11-26`. The device's own time zone is never used. */
export function todayIn(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export type Method = "CASH" | "CARD" | "BANK_TRANSFER";

export const METHODS: readonly { readonly value: Method; readonly label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
];

export interface PaymentDraft {
  readonly amount: string;
  readonly method: Method;
  readonly paidOn: string;
  readonly proofLink: string;
}

export interface PaymentErrors {
  readonly amount?: string;
  readonly paidOn?: string;
  readonly proofLink?: string;
}

export const AMOUNT_ZERO = "Enter an amount more than zero.";
export const DATE_INVALID = "Enter a date like 2026-11-26.";
export const DATE_FUTURE = "The date received cannot be in the future.";
export const LINK_INVALID = "Enter a link that starts with https://.";

export interface PaymentValue {
  /** Integer minor units. */
  readonly amount: number;
  readonly method: Method;
  readonly paidOn: string;
  readonly proofLink: string | null;
}

export type Checked =
  | { readonly ok: true; readonly value: PaymentValue }
  | { readonly ok: false; readonly errors: PaymentErrors };

/** The amount as typed, or the reason it cannot be sent. More than two decimals is refused here, before any request. */
export function checkAmount(
  text: string,
  currency: string,
): { readonly ok: true; readonly minor: number } | { readonly ok: false; readonly error: string } {
  const parsed = parseMoneyInput(text, currency);
  if (!parsed.ok) return parsed;
  return parsed.minor > 0 ? parsed : { ok: false, error: AMOUNT_ZERO };
}

/** Dates are `YYYY-MM-DD`, so comparing the text compares the days. `today` is the gym's local date. */
export function checkDate(text: string, today: string): string | null {
  if (!isCalendarDate(text)) return DATE_INVALID;
  return text > today ? DATE_FUTURE : null;
}

export function validatePayment(draft: PaymentDraft, currency: string, today: string): Checked {
  const amount = checkAmount(draft.amount, currency);
  const paidOn = draft.paidOn.trim();
  const dateError = checkDate(paidOn, today);
  const proof = draft.proofLink.trim();
  const errors: PaymentErrors = {
    ...(amount.ok ? {} : { amount: amount.error }),
    ...(dateError === null ? {} : { paidOn: dateError }),
    ...(proof === "" || /^https?:\/\/\S+$/i.test(proof) ? {} : { proofLink: LINK_INVALID }),
  };
  if (Object.keys(errors).length > 0 || !amount.ok) return { ok: false, errors };
  return {
    ok: true,
    value: {
      amount: amount.minor,
      method: draft.method,
      paidOn,
      proofLink: proof === "" ? null : proof,
    },
  };
}
