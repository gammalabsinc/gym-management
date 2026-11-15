import { daysInMonth, isCalendarDate } from "./calendar";
import { type ValidationError, validationError } from "./errors";
import { andThen, ok, type Result } from "./result";

/** A calendar date written YYYY-MM-DD. Billing never uses timestamps. */
export type DateText = string;

/** One billing cycle. `end` is inclusive: the day before the next cycle starts. */
export interface BillingCycle {
  readonly start: DateText;
  readonly end: DateText;
}

export const MAX_CYCLES_PER_CALL = 120;
/** Keeps every date four digits wide and keeps the month before January valid. */
export const MIN_YEAR = 1900;
export const MAX_YEAR = 9000;

interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function formatDate({ year, month, day }: DateParts): DateText {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function parseDateText(text: string, field: string): Result<DateParts, ValidationError> {
  const parts = isCalendarDate(text)
    ? {
        year: Number(text.slice(0, 4)),
        month: Number(text.slice(5, 7)),
        day: Number(text.slice(8, 10)),
      }
    : null;
  if (parts === null || parts.year < MIN_YEAR || parts.year > MAX_YEAR) {
    return validationError(
      `${field} must be a real date written YYYY-MM-DD from ${MIN_YEAR} to ${MAX_YEAR}`,
      [{ path: [field], message: `must be a real date from ${MIN_YEAR} to ${MAX_YEAR}` }],
    );
  }
  return ok(parts);
}

export function parseBillingDay(value: unknown): Result<number, ValidationError> {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 31) {
    return ok(value);
  }
  return validationError("billingDay must be a whole number from 1 to 31", [
    { path: ["billingDay"], message: "must be a whole number from 1 to 31" },
  ]);
}

/** Month index counts months from year 0, so adding a month never needs a year rollover branch. */
function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function fromMonthIndex(index: number): { readonly year: number; readonly month: number } {
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** The cycle start in a month. A billing day past the end of a short month lands on its last day. */
function startInMonth(billingDay: number, index: number): DateParts {
  const { year, month } = fromMonthIndex(index);
  return { year, month, day: Math.min(billingDay, daysInMonth(year, month)) };
}

function dayBefore({ year, month, day }: DateParts): DateParts {
  if (day > 1) return { year, month, day: day - 1 };
  const previous = fromMonthIndex(monthIndex(year, month) - 1);
  return { ...previous, day: daysInMonth(previous.year, previous.month) };
}

/** Cycle starts are derived from the billing day each month, never chained from the last start. */
function cycleAtIndex(billingDay: number, index: number): BillingCycle {
  const start = startInMonth(billingDay, index);
  const nextStart = startInMonth(billingDay, index + 1);
  return { start: formatDate(start), end: formatDate(dayBefore(nextStart)) };
}

function indexOfCycleContaining(billingDay: number, date: DateParts): number {
  const index = monthIndex(date.year, date.month);
  return date.day >= startInMonth(billingDay, index).day ? index : index - 1;
}

/** The one cycle that holds `date`. */
export function cycleContaining(
  billingDay: number,
  date: DateText,
): Result<BillingCycle, ValidationError> {
  return andThen(parseBillingDay(billingDay), (day) =>
    andThen(parseDateText(date, "date"), (parts) =>
      ok(cycleAtIndex(day, indexOfCycleContaining(day, parts))),
    ),
  );
}

/** `count` back to back cycles, the first one being the cycle that holds `from`. */
export function cyclesFrom(
  billingDay: number,
  from: DateText,
  count: number,
): Result<readonly BillingCycle[], ValidationError> {
  if (!Number.isInteger(count) || count < 0 || count > MAX_CYCLES_PER_CALL) {
    return validationError(`count must be a whole number from 0 to ${MAX_CYCLES_PER_CALL}`, [
      { path: ["count"], message: `must be a whole number from 0 to ${MAX_CYCLES_PER_CALL}` },
    ]);
  }
  return andThen(parseBillingDay(billingDay), (day) =>
    andThen(parseDateText(from, "from"), (parts) => {
      const first = indexOfCycleContaining(day, parts);
      return ok(Array.from({ length: count }, (_, offset) => cycleAtIndex(day, first + offset)));
    }),
  );
}
