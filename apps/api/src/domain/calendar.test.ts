import { describe, expect, it } from "vitest";
import { daysBetween, daysInMonth, isCalendarDate, isLeapYear } from "./calendar";

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

describe("daysBetween", () => {
  it("counts days forward, backward and zero", () => {
    expect(daysBetween("2026-03-01", "2026-03-01")).toBe(0);
    expect(daysBetween("2026-03-01", "2026-03-06")).toBe(5);
    expect(daysBetween("2026-03-06", "2026-03-01")).toBe(-5);
  });

  it("crosses month ends, leap days and years", () => {
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-01-01", "2027-01-01")).toBe(365);
    expect(daysBetween("2024-01-01", "2025-01-01")).toBe(366);
    expect(daysBetween("1900-02-28", "1900-03-01")).toBe(1);
    expect(daysBetween("2000-02-28", "2000-03-01")).toBe(2);
  });

  it("moves by exactly one day across every date of 2023 to 2025, leap year included", () => {
    let previous = "2022-12-31";
    for (const year of [2023, 2024, 2025]) {
      for (let month = 1; month <= 12; month++) {
        for (let day = 1; day <= daysInMonth(year, month); day++) {
          const text = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          expect(daysBetween(previous, text), text).toBe(1);
          previous = text;
        }
      }
    }
  });
});
