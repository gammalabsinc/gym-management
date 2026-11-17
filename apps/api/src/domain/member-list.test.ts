import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  MAX_PAGE_SIZE,
  MAX_SEARCH_LENGTH,
  monthWindows,
  parseMemberList,
  STANDING_RANK,
} from "./member-list";

const ID = "55555555-5555-4555-8555-555555555555";

describe("parseMemberList", () => {
  it("uses the defaults", () => {
    expect(parseMemberList({})).toEqual({
      ok: true,
      value: { search: null, limit: DEFAULT_PAGE_SIZE, after: null },
    });
    expect(parseMemberList({ search: "  ", limit: null, cursor: "" })).toEqual({
      ok: true,
      value: { search: null, limit: DEFAULT_PAGE_SIZE, after: null },
    });
  });

  it("trims the search", () => {
    const result = parseMemberList({ search: "  ada  " });
    expect(result.ok && result.value.search).toBe("ada");
  });

  it("caps the search length", () => {
    expect(parseMemberList({ search: "a".repeat(MAX_SEARCH_LENGTH) }).ok).toBe(true);
    const result = parseMemberList({ search: "a".repeat(MAX_SEARCH_LENGTH + 1) });
    expect(!result.ok && result.error.issues[0]?.path).toEqual(["search"]);
  });

  it("holds the page size to a hard maximum", () => {
    const result = parseMemberList({ limit: 100_000 });
    expect(result.ok && result.value.limit).toBe(MAX_PAGE_SIZE);
    const small = parseMemberList({ limit: 7 });
    expect(small.ok && small.value.limit).toBe(7);
  });

  it("refuses a page size that is not a whole number of 1 or more", () => {
    for (const limit of [0, -3, 2.5, Number.NaN]) {
      const result = parseMemberList({ limit });
      expect(!result.ok && result.error.issues[0]?.path).toEqual(["limit"]);
    }
  });

  it("reads the cursor it handed out", () => {
    const cursor = encodeCursor({ rank: 1, sortName: "ada lovelace", id: ID });
    const result = parseMemberList({ cursor });
    expect(result.ok && result.value.after).toEqual({ rank: 1, sortName: "ada lovelace", id: ID });
  });

  it("reports every problem at once", () => {
    const result = parseMemberList({ search: "a".repeat(100), limit: 0, cursor: "nope" });
    expect(!result.ok && result.error.issues.map((issue) => issue.path[0])).toEqual([
      "search",
      "limit",
      "cursor",
    ]);
  });
});

describe("cursors", () => {
  it("round trips names with any characters", () => {
    const cursor = { rank: 0, sortName: "zoë o'neil 山田", id: ID };
    expect(decodeCursor(encodeCursor(cursor))).toEqual({ ok: true, value: cursor });
  });

  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

  it.each([
    ["not base64 json", "%%%"],
    ["too long", "a".repeat(513)],
    ["not an array", encode({ rank: 0 })],
    ["wrong length", encode([0, "a"])],
    ["rank out of range", encode([4, "a", ID])],
    ["rank not whole", encode([1.5, "a", ID])],
    ["name not text", encode([0, 5, ID])],
    ["id not text", encode([0, "a", 5])],
    ["id not a uuid", encode([0, "a", "xyz"])],
    ["name too long", encode([0, "a".repeat(321), ID])],
  ])("refuses a cursor that is %s", (_name, text) => {
    const result = decodeCursor(text);
    expect(!result.ok && result.error.issues).toEqual([
      { path: ["cursor"], message: "Not a valid cursor" },
    ]);
  });
});

describe("STANDING_RANK", () => {
  it("puts overdue first and inactive last", () => {
    expect(STANDING_RANK).toEqual({ overdue: 0, due_soon: 1, paid: 2, inactive: 3 });
  });
});

describe("monthWindows", () => {
  it("gives the three month starts", () => {
    expect(monthWindows("2026-11-16")).toEqual({
      lastStart: "2026-10-01",
      thisStart: "2026-11-01",
      nextStart: "2026-12-01",
    });
  });

  it("wraps over the year ends", () => {
    expect(monthWindows("2026-01-31")).toEqual({
      lastStart: "2025-12-01",
      thisStart: "2026-01-01",
      nextStart: "2026-02-01",
    });
    expect(monthWindows("2026-12-05")).toEqual({
      lastStart: "2026-11-01",
      thisStart: "2026-12-01",
      nextStart: "2027-01-01",
    });
  });
});
