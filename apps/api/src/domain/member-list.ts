import { type FieldIssue, type ValidationError, validationError } from "./errors";
import { ok, type Result } from "./result";
import type { Standing } from "./standing";
import { parseUuid } from "./uuid";

export const DEFAULT_PAGE_SIZE = 50;
/** A hard cap: a larger request is served with this many rows, never more. */
export const MAX_PAGE_SIZE = 100;
export const MAX_SEARCH_LENGTH = 64;
const MAX_CURSOR_LENGTH = 512;
const MAX_SORT_NAME_LENGTH = 320;

/** Overdue first, then due soon, then paid, and inactive members last. */
export const STANDING_RANK: Readonly<Record<Standing, number>> = {
  overdue: 0,
  due_soon: 1,
  paid: 2,
  inactive: 3,
};

/** What the list screen sends. */
export interface MemberListInput {
  readonly search?: string | null | undefined;
  readonly limit?: number | null | undefined;
  readonly cursor?: string | null | undefined;
}

/** The position after which the next page starts: the sort key of the last row sent. */
export interface MemberCursor {
  readonly rank: number;
  readonly sortName: string;
  readonly id: string;
}

export interface MemberListQuery {
  /** Trimmed, at most MAX_SEARCH_LENGTH characters, or null for no search. */
  readonly search: string | null;
  readonly limit: number;
  readonly after: MemberCursor | null;
}

function parseSearch(search: string | null | undefined): Result<string | null, ValidationError> {
  const trimmed = search?.trim() ?? "";
  if (trimmed.length > MAX_SEARCH_LENGTH) {
    return validationError("Invalid search", [
      { path: ["search"], message: `At most ${MAX_SEARCH_LENGTH} characters` },
    ]);
  }
  return ok(trimmed === "" ? null : trimmed);
}

export function parseLimit(limit: number | null | undefined): Result<number, ValidationError> {
  if (limit === null || limit === undefined) return ok(DEFAULT_PAGE_SIZE);
  if (!Number.isInteger(limit) || limit < 1) {
    return validationError("Invalid page", [
      { path: ["limit"], message: "Must be a whole number of 1 or more" },
    ]);
  }
  return ok(Math.min(limit, MAX_PAGE_SIZE));
}

/** The cursor is opaque to clients. It is the sort key of the last row, so no offset is ever scanned. */
export function encodeCursor(cursor: MemberCursor): string {
  return Buffer.from(JSON.stringify([cursor.rank, cursor.sortName, cursor.id])).toString(
    "base64url",
  );
}

function badCursor(): Result<never, ValidationError> {
  return validationError("Invalid page", [{ path: ["cursor"], message: "Not a valid cursor" }]);
}

function isRank(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 3;
}

export function decodeCursor(text: string): Result<MemberCursor, ValidationError> {
  if (text.length > MAX_CURSOR_LENGTH) return badCursor();
  let parts: unknown;
  try {
    parts = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    return badCursor();
  }
  if (!Array.isArray(parts) || parts.length !== 3) return badCursor();
  const [rank, sortName, id] = parts as unknown[];
  if (!isRank(rank) || typeof sortName !== "string" || typeof id !== "string") return badCursor();
  if (sortName.length > MAX_SORT_NAME_LENGTH) return badCursor();
  const uuid = parseUuid(id, "cursor");
  return uuid.ok ? ok({ rank, sortName, id: uuid.value }) : badCursor();
}

function parseCursor(
  cursor: string | null | undefined,
): Result<MemberCursor | null, ValidationError> {
  if (cursor === null || cursor === undefined || cursor === "") return ok(null);
  return decodeCursor(cursor);
}

/** Checks the search, the page size and the cursor. Every problem is reported at once. */
export function parseMemberList(input: MemberListInput): Result<MemberListQuery, ValidationError> {
  const search = parseSearch(input.search);
  const limit = parseLimit(input.limit);
  const after = parseCursor(input.cursor);
  const issues: FieldIssue[] = [search, limit, after].flatMap((part) =>
    part.ok ? [] : part.error.issues,
  );
  if (!search.ok || !limit.ok || !after.ok) return validationError("Invalid member list", issues);
  return ok({ search: search.value, limit: limit.value, after: after.value });
}

/** The first day of last month, this month and next month, for counting visits. */
export interface MonthWindows {
  readonly lastStart: string;
  readonly thisStart: string;
  readonly nextStart: string;
}

function firstOfMonth(year: number, month: number): string {
  const wrappedYear = year + Math.floor((month - 1) / 12);
  const wrappedMonth = ((((month - 1) % 12) + 12) % 12) + 1;
  return `${String(wrappedYear).padStart(4, "0")}-${String(wrappedMonth).padStart(2, "0")}-01`;
}

/** The month windows around the gym's local date `today`, written YYYY-MM-DD. */
export function monthWindows(today: string): MonthWindows {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return {
    lastStart: firstOfMonth(year, month - 1),
    thisStart: firstOfMonth(year, month),
    nextStart: firstOfMonth(year, month + 1),
  };
}
