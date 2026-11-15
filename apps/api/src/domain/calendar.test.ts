import { describe, expect, it } from "vitest";
import { daysInMonth, isCalendarDate, isLeapYear } from "./calendar";

describe("isLeapYear", () => {
  it("follows the Gregorian rules", () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });
});

describe("daysInMonth", () => {
  it("returns the length of each month, with February by leap year", () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
  });

  it("returns 0 for a month that does not exist", () => {
    expect(daysInMonth(2026, 0)).toBe(0);
    expect(daysInMonth(2026, 13)).toBe(0);
  });
});

describe("isCalendarDate", () => {
  it("accepts real dates, including a leap day", () => {
    expect(isCalendarDate("2026-11-14")).toBe(true);
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2026-12-31")).toBe(true);
  });

  it("rejects dates that do not exist", () => {
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-04-31")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-00-10")).toBe(false);
    expect(isCalendarDate("2026-01-00")).toBe(false);
    expect(isCalendarDate("0000-01-01")).toBe(false);
  });

  it("rejects text that is not YYYY-MM-DD", () => {
    for (const text of [
      "",
      "2026-1-5",
      "26-01-05",
      "2026/01/05",
      "2026-01-05T00:00:00Z",
      " 2026-01-05",
    ]) {
      expect(isCalendarDate(text)).toBe(false);
    }
  });
});
