import { describe, expect, it } from "vitest";
import { toListRows } from "./group";

const visit = (id: string, localDate: string, scannedAt = `${localDate}T12:00:00Z`) => ({
  id,
  localDate,
  scannedAt,
});

describe("toListRows", () => {
  it("is empty without visits", () => {
    expect(toListRows([])).toEqual([]);
  });

  it("adds a heading where the month changes and keeps the API order", () => {
    const rows = toListRows([
      visit("a", "2026-11-20"),
      visit("b", "2026-11-02"),
      visit("c", "2026-10-31"),
    ]);
    expect(rows.map((row) => (row.kind === "month" ? row.label : row.key))).toEqual([
      "November 2026",
      "visit-a",
      "visit-b",
      "October 2026",
      "visit-c",
    ]);
  });

  it("groups by the gym's local date, not by the instant", () => {
    // 2026-12-01 02:30 UTC is still 30 November in Toronto. The API says so in localDate.
    const rows = toListRows([visit("a", "2026-11-30", "2026-12-01T02:30:00Z")]);
    expect(rows[0]).toMatchObject({ kind: "month", label: "November 2026" });
  });
});
