/** Digits after the decimal point for the currencies the app expects. Others default to 2. */
const EXPONENTS: Readonly<Record<string, number>> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  JOD: 3,
  TND: 3,
};

const SYMBOLS: Readonly<Record<string, string>> = {
  USD: "$",
  CAD: "$",
  AUD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  INR: "₹",
  PKR: "Rs ",
  AED: "AED ",
};

export function currencyExponent(currency: string): number {
  return EXPONENTS[currency] ?? 2;
}

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Formats integer minor units for display, for example 7000 USD becomes "$70.00".
 * Works on the digits of the integer, so no float arithmetic touches an amount.
 */
export function formatMoney(minor: number, currency: string): string {
  if (!Number.isSafeInteger(minor))
    throw new RangeError("Amount must be an integer in minor units");
  const exponent = currencyExponent(currency);
  const sign = minor < 0 ? "-" : "";
  const digits = String(Math.abs(minor)).padStart(exponent + 1, "0");
  const whole = group(digits.slice(0, digits.length - exponent));
  const fraction = exponent === 0 ? "" : `.${digits.slice(digits.length - exponent)}`;
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  return `${sign}${symbol}${whole}${fraction}`;
}
