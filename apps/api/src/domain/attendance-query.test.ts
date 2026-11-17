import { describe, expect, it } from "vitest";
import {
  decodeAttendanceCursor,
  encodeAttendanceCursor,
  fillDayCounts,
  MAX_REPORT_DAYS,
  parseAttendancePage,
  parseDayRange,
  parseMemberHistory,
} from "./attendance-query";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./member-list";

const ID = "11111111-1111-4111-8111-111111111111";
const POSITION = { scannedAt: "2026-11-16T12:05:00.123456Z", id: ID };

function cursorOf(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe("attendance cursor", () => {
  it("round trips a position", () => {
    const decoded = decodeAttendanceCursor(encodeAttendanceCursor(POSITION));
    expect(decoded).toEqual({ ok: true, value: POSITION });
  });

  it("accepts an instant without fractions and lowercases the id", () => {
    const decoded = decodeAttendanceCursor(cursorOf(["2026-11-16T12:05:00Z", ID.toUpperCase()]));
    expect(decoded).toEqual({ ok: true, value: { scannedAt: "2026-11-16T12:05:00Z", id: ID } });
  });

  it.each([
    ["not base64 json", "%%%"],
    ["not an array", cursorOf({ a: 1 })],
    ["wrong length", cursorOf(["2026-11-16T12:05:00Z"])],
    ["a number for the time", cursorOf([5, ID])],
    ["a time in the wrong shape", cursorOf(["2026-11-16 12:05:00", ID])],
    ["a day that does not exist", cursorOf(["2026-02-30T12:05:00Z", ID])],
    ["a number for the id", cursorOf(["2026-11-16T12:05:00Z", 5])],
    ["an hour that does not exist", cursorOf(["2026-11-16T25:05:00Z", ID])],
    ["an id that is not a uuid", cursorOf(["2026-11-16T12:05:00Z", "nope"])],
    ["too long", "a".repeat(200)],
  ])("refuses a cursor that is %s", (_name, text) => {
    const decoded = decodeAttendanceCursor(text);
    expect(decoded.ok).toBe(false);
    if (!decoded.ok) expect(decoded.error.issues[0]?.path).toEqual(["cursor"]);
  });
});

describe("parseAttendancePage", () => {
  it("uses the default size and no position", () => {
    expect(parseAttendancePage({})).toEqual({
      ok: true,
      value: { limit: DEFAULT_PAGE_SIZE, after: null },
    });
  });

  it("treats an empty or missing cursor as the first page", () => {
    for (const cursor of ["", null, undefined]) {
      expect(parseAttendancePage({ cursor })).toMatchObject({ ok: true, value: { after: null } });
    }
  });

  it("caps the page size", () => {
    expect(parseAttendancePage({ limit: 10_000 })).toMatchObject({
      ok: true,
      value: { limit: MAX_PAGE_SIZE },
    });
  });

  it("reports a bad size and a bad cursor together", () => {
    const parsed = parseAttendancePage({ limit: 0, cursor: "%%%" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.issues.map((i) => i.path[0])).toEqual(["limit", "cursor"]);
  });

  it("carries a valid cursor", () => {
    const parsed = parseAttendancePage({ limit: 5, cursor: encodeAttendanceCursor(POSITION) });
    expect(parsed).toEqual({ ok: true, value: { limit: 5, after: POSITION } });
  });
});

describe("parseMemberHistory", () => {
  it("normalises the member id and keeps the page", () => {
    const parsed = parseMemberHistory({ memberId: ` ${ID.toUpperCase()} `, limit: 3 });
    expect(parsed).toEqual({ ok: true, value: { memberId: ID, limit: 3, after: null } });
  });

  it("reports a bad id and a bad page together", () => {
    const parsed = parseMemberHistory({ memberId: "nope", limit: -1 });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.issues.map((i) => i.path[0])).toEqual(["memberId", "limit"]);
    }
  });
});

describe("parseDayRange", () => {
  it("accepts a range of one day and the longest range", () => {
    expect(parseDayRange({ from: "2026-11-16", to: "2026-11-16" }).ok).toBe(true);
    expect(parseDayRange({ from: "2026-01-01", to: "2026-12-31" }).ok).toBe(true);
    expect(MAX_REPORT_DAYS).toBe(366);
  });

  it("refuses dates that are not real", () => {
    const parsed = parseDayRange({ from: "2026-02-30", to: "nope" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.issues.map((i) => i.path[0])).toEqual(["from", "to"]);
  });

  it("refuses an end before the start", () => {
    const parsed = parseDayRange({ from: "2026-11-16", to: "2026-11-15" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.issues[0]?.message).toBe("Must not be before from");
  });

  it("refuses a range of more than a year", () => {
    const parsed = parseDayRange({ from: "2026-01-01", to: "2027-01-02" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.issues[0]?.message).toBe("At most 366 days");
  });
});

describe("fillDayCounts", () => {
  it("lists every day and puts zero where nothing was counted", () => {
    const filled = fillDayCounts({ from: "2026-02-27", to: "2026-03-02" }, [
      { date: "2026-02-28", visits: 4 },
      { date: "2026-03-01", visits: 1 },
    ]);
    expect(filled).toEqual([
      { date: "2026-02-27", visits: 0 },
      { date: "2026-02-28", visits: 4 },
      { date: "2026-03-01", visits: 1 },
      { date: "2026-03-02", visits: 0 },
    ]);
  });
});
