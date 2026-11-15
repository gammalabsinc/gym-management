import { describe, expect, it } from "vitest";
import {
  type BillingCycle,
  cycleContaining,
  cyclesFrom,
  MAX_CYCLES_PER_CALL,
  MAX_YEAR,
  MIN_YEAR,
  parseBillingDay,
} from "./billing-cycle";
import { daysInMonth } from "./calendar";

function cycleOf(billingDay: number, date: string): BillingCycle {
  const result = cycleContaining(billingDay, date);
  if (!result.ok) throw new Error(`unexpected failure for ${billingDay} ${date}`);
  return result.value;
}

function cyclesOf(billingDay: number, from: string, count: number): readonly BillingCycle[] {
  const result = cyclesFrom(billingDay, from, count);
  if (!result.ok) throw new Error(`unexpected failure for ${billingDay} ${from}`);
  return result.value;
}

const pad = (value: number): string => String(value).padStart(2, "0");
const date = (year: number, month: number, day: number): string =>
  `${year}-${pad(month)}-${pad(day)}`;

function nextDay(text: string): string {
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = Number(text.slice(8, 10));
  if (day < daysInMonth(year, month)) return date(year, month, day + 1);
  return month === 12 ? date(year + 1, 1, 1) : date(year, month + 1, 1);
}

describe("parseBillingDay", () => {
  it("accepts 1 to 31", () => {
    expect(parseBillingDay(1)).toEqual({ ok: true, value: 1 });
    expect(parseBillingDay(31)).toEqual({ ok: true, value: 31 });
  });

  it("rejects 0, 32, fractions and non numbers", () => {
    for (const value of [0, 32, -1, 15.5, Number.NaN, "15", null]) {
      expect(parseBillingDay(value).ok).toBe(false);
    }
  });
});

describe("cycleContaining", () => {
  it("starts on the billing day and ends the day before the next one", () => {
    expect(cycleOf(15, "2026-03-20")).toEqual({ start: "2026-03-15", end: "2026-04-14" });
    expect(cycleOf(15, "2026-03-15")).toEqual({ start: "2026-03-15", end: "2026-04-14" });
    expect(cycleOf(15, "2026-04-14")).toEqual({ start: "2026-03-15", end: "2026-04-14" });
  });

  it("uses the previous month when the date is before the billing day", () => {
    expect(cycleOf(15, "2026-03-10")).toEqual({ start: "2026-02-15", end: "2026-03-14" });
  });

  it("crosses a year boundary in both directions", () => {
    expect(cycleOf(20, "2026-01-05")).toEqual({ start: "2025-12-20", end: "2026-01-19" });
    expect(cycleOf(20, "2026-12-25")).toEqual({ start: "2026-12-20", end: "2027-01-19" });
  });

  it("puts day 31 on the last day of short months", () => {
    expect(cycleOf(31, "2026-02-10")).toEqual({ start: "2026-01-31", end: "2026-02-27" });
    expect(cycleOf(31, "2026-02-28")).toEqual({ start: "2026-02-28", end: "2026-03-30" });
    expect(cycleOf(31, "2026-04-30")).toEqual({ start: "2026-04-30", end: "2026-05-30" });
  });

  it("handles billing day 29 and 30 around a leap February", () => {
    expect(cycleOf(29, "2024-02-29")).toEqual({ start: "2024-02-29", end: "2024-03-28" });
    expect(cycleOf(29, "2026-02-28")).toEqual({ start: "2026-02-28", end: "2026-03-28" });
    expect(cycleOf(30, "2024-02-29")).toEqual({ start: "2024-02-29", end: "2024-03-29" });
  });

  it("returns to the billing day after a short month, it does not drift", () => {
    expect(cycleOf(31, "2026-03-31")).toEqual({ start: "2026-03-31", end: "2026-04-29" });
  });

  it("rejects an invalid billing day or date with a validation error", () => {
    const badDay = cycleContaining(32, "2026-01-01");
    expect(!badDay.ok && badDay.error.kind).toBe("validation");
    for (const text of ["2026-02-30", "26-01-01", "", "2026-1-1", `${MIN_YEAR - 1}-06-01`]) {
      const result = cycleContaining(10, text);
      expect(!result.ok && result.error.issues[0]?.path).toEqual(["date"]);
    }
    expect(cycleContaining(10, `${MAX_YEAR + 1}-06-01`).ok).toBe(false);
  });

  it("accepts the first and last supported year", () => {
    expect(cycleContaining(1, `${MIN_YEAR}-01-01`).ok).toBe(true);
    expect(cycleContaining(31, `${MAX_YEAR}-12-31`).ok).toBe(true);
  });
});

describe("cyclesFrom", () => {
  it("returns back to back cycles starting with the one that holds the date", () => {
    expect(cyclesOf(31, "2026-01-31", 3)).toEqual([
      { start: "2026-01-31", end: "2026-02-27" },
      { start: "2026-02-28", end: "2026-03-30" },
      { start: "2026-03-31", end: "2026-04-29" },
    ]);
  });

  it("returns nothing for a count of zero", () => {
    expect(cyclesOf(10, "2026-01-01", 0)).toEqual([]);
  });

  it("allows up to the cap and no more", () => {
    expect(cyclesOf(10, "2026-01-01", MAX_CYCLES_PER_CALL)).toHaveLength(MAX_CYCLES_PER_CALL);
    for (const count of [-1, MAX_CYCLES_PER_CALL + 1, 1.5, Number.NaN]) {
      const result = cyclesFrom(10, "2026-01-01", count);
      expect(!result.ok && result.error.issues[0]?.path).toEqual(["count"]);
    }
  });

  it("rejects an invalid billing day or start date", () => {
    expect(cyclesFrom(0, "2026-01-01", 2).ok).toBe(false);
    const result = cyclesFrom(10, "2026-13-01", 2);
    expect(!result.ok && result.error.issues[0]?.path).toEqual(["from"]);
  });
});

describe("billing cycle properties, checked for every billing day over 1999 to 2101", () => {
  const sequences: { billingDay: number; cycles: readonly BillingCycle[] }[] = [];
  for (let billingDay = 1; billingDay <= 31; billingDay++) {
    const cycles: BillingCycle[] = [];
    let from = "1999-01-01";
    while (cycles.length < 12 * 103) {
      const chunk = cyclesOf(billingDay, from, 103);
      cycles.push(...chunk);
      const last = chunk[chunk.length - 1];
      if (last === undefined) throw new Error("empty chunk");
      from = nextDay(last.end);
    }
    sequences.push({ billingDay, cycles });
  }

  it("never leaves a gap and never overlaps: each cycle starts the day after the last ends", () => {
    for (const { billingDay, cycles } of sequences) {
      for (const [index, cycle] of cycles.entries()) {
        const following = cycles[index + 1];
        expect(cycle.start <= cycle.end, `day ${billingDay} ${cycle.start}`).toBe(true);
        if (following !== undefined) {
          expect(nextDay(cycle.end), `day ${billingDay} ${cycle.end}`).toBe(following.start);
        }
      }
    }
  });

  it("starts exactly one cycle in every calendar month", () => {
    for (const { cycles } of sequences) {
      const months = cycles.map((cycle) => cycle.start.slice(0, 7));
      expect(new Set(months).size).toBe(months.length);
    }
  });

  it("starts on min(billing day, last day of the month), so day 31 lands on the last day of short months", () => {
    for (const { billingDay, cycles } of sequences) {
      for (const cycle of cycles) {
        const year = Number(cycle.start.slice(0, 4));
        const month = Number(cycle.start.slice(5, 7));
        const day = Number(cycle.start.slice(8, 10));
        expect(day, `day ${billingDay} ${cycle.start}`).toBe(
          Math.min(billingDay, daysInMonth(year, month)),
        );
      }
    }
    expect(cycleOf(31, "2026-04-30").start).toBe("2026-04-30");
    expect(cycleOf(31, "2026-06-30").start).toBe("2026-06-30");
    expect(cycleOf(31, "2026-09-30").start).toBe("2026-09-30");
    expect(cycleOf(31, "2026-11-30").start).toBe("2026-11-30");
    expect(cycleOf(31, "2026-02-28").start).toBe("2026-02-28");
    expect(cycleOf(31, "2028-02-29").start).toBe("2028-02-29");
  });

  it("holds every date in exactly one cycle, the one cycleContaining returns", () => {
    for (let billingDay = 1; billingDay <= 31; billingDay++) {
      for (const year of [2023, 2024, 2100]) {
        for (let month = 1; month <= 12; month++) {
          for (let day = 1; day <= daysInMonth(year, month); day++) {
            const text = date(year, month, day);
            const cycle = cycleOf(billingDay, text);
            expect(cycle.start <= text && text <= cycle.end, `${billingDay} ${text}`).toBe(true);
          }
        }
      }
    }
  });
});
