import { currencyExponent } from "../ui/money";

export type Parsed =
  | { readonly ok: true; readonly minor: number }
  | { readonly ok: false; readonly error: string };

const MAX_WHOLE_DIGITS = 9;

/**
 * Typed money becomes integer minor units with string maths only, so no float ever touches an amount.
 * At most the currency's decimal places are accepted. A leading currency sign and commas are ignored.
 */
export function parseMoneyInput(text: string, currency: string): Parsed {
  const exponent = currencyExponent(currency);
  const cleaned = text
    .trim()
    .replace(/^[^\d.-]+/, "")
    .replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (match === null) return { ok: false, error: "Enter an amount, like 50.00." };
  const whole = match[1] as string;
  const fraction = match[2] ?? "";
  if (fraction.length > exponent) {
    return {
      ok: false,
      error: exponent === 0 ? "Enter a whole amount." : `Use at most ${exponent} decimal places.`,
    };
  }
  if (whole.replace(/^0+(?=\d)/, "").length > MAX_WHOLE_DIGITS) {
    return { ok: false, error: "That amount is too large." };
  }
  return { ok: true, minor: Number(`${whole}${fraction.padEnd(exponent, "0")}`) };
}

/** Integer minor units as the plain number a person types, for example 5000 USD becomes "50.00". */
export function formatMoneyInput(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  const digits = String(minor).padStart(exponent + 1, "0");
  return exponent === 0
    ? digits
    : `${digits.slice(0, digits.length - exponent)}.${digits.slice(digits.length - exponent)}`;
}

/** A whole number of days or minutes. */
export function parseWholeNumber(text: string, max: number): Parsed {
  const trimmed = text.trim();
  if (!/^\d{1,5}$/.test(trimmed)) return { ok: false, error: "Enter a whole number." };
  const value = Number(trimmed);
  return value > max ? { ok: false, error: `Enter ${max} or less.` } : { ok: true, minor: value };
}
