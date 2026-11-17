const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Month is 1 to 12. Returns 0 for a month outside that range. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1] ?? 0;
}

/** True only for a real calendar date written as YYYY-MM-DD, so 2026-02-30 and 2026-13-01 fail. */
export function isCalendarDate(text: string): boolean {
  const match = DATE_PATTERN.exec(text);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return year >= 1 && day >= 1 && day <= daysInMonth(year, month);
}

/** Days since 0000-03-01 for a real calendar date, so two dates subtract to a day count. */
function dayNumber(text: string): number {
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = Number(text.slice(8, 10));
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 400);
  const yearOfEra = shiftedYear - era * 400;
  const monthFromMarch = (month + 9) % 12;
  const dayOfYear = Math.floor((153 * monthFromMarch + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra;
}

/** Whole days from `from` to `to`, negative when `to` is earlier. Both must pass isCalendarDate. */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** The calendar day after a real calendar date. Both are written YYYY-MM-DD. */
export function nextDate(text: string): string {
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = Number(text.slice(8, 10));
  const parts =
    day < daysInMonth(year, month)
      ? { year, month, day: day + 1 }
      : month < 12
        ? { year, month: month + 1, day: 1 }
        : { year: year + 1, month: 1, day: 1 };
  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
}

/**
 * The calendar date of an instant in an IANA time zone, written YYYY-MM-DD. Every billing date is
 * the gym's local date, never the UTC date. The zone comes from the tenant row, so an unknown zone
 * is a bug and throws.
 */
export function localDateIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}
