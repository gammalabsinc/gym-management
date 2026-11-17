import { addDays, daysBetween, isCalendarDate } from "./calendar";
import { type FieldIssue, type ValidationError, validationError } from "./errors";
import { parseLimit } from "./member-list";
import { ok, type Result } from "./result";
import { parseUuid } from "./uuid";

/** Longest span a per day report may cover, so one request cannot ask for years of rows. */
export const MAX_REPORT_DAYS = 366;
const MAX_CURSOR_LENGTH = 128;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

/** Where the next page starts: the time and id of the last row sent. Rows run newest first. */
export interface AttendancePosition {
  readonly scannedAt: string;
  readonly id: string;
}

/** What a list screen sends to read a page. */
export interface AttendancePageInput {
  readonly limit?: number | null | undefined;
  readonly cursor?: string | null | undefined;
}

export interface AttendancePageQuery {
  readonly limit: number;
  readonly after: AttendancePosition | null;
}

/** The cursor is opaque to clients. It is the sort key of the last row, so no offset is scanned. */
export function encodeAttendanceCursor(position: AttendancePosition): string {
  return Buffer.from(JSON.stringify([position.scannedAt, position.id])).toString("base64url");
}

function badCursor(): Result<never, ValidationError> {
  return validationError("Invalid page", [{ path: ["cursor"], message: "Not a valid cursor" }]);
}

/** A UTC instant in the shape the database writes. Date.parse rolls 30 February over, so the day is checked too. */
function isInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    TIMESTAMP_PATTERN.test(value) &&
    isCalendarDate(value.slice(0, 10)) &&
    !Number.isNaN(Date.parse(value))
  );
}

export function decodeAttendanceCursor(text: string): Result<AttendancePosition, ValidationError> {
  if (text.length > MAX_CURSOR_LENGTH) return badCursor();
  let parts: unknown;
  try {
    parts = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    return badCursor();
  }
  if (!Array.isArray(parts) || parts.length !== 2) return badCursor();
  const [scannedAt, id] = parts as unknown[];
  if (!isInstant(scannedAt) || typeof id !== "string") return badCursor();
  const uuid = parseUuid(id, "cursor");
  return uuid.ok ? ok({ scannedAt, id: uuid.value }) : badCursor();
}

function parseCursor(
  cursor: string | null | undefined,
): Result<AttendancePosition | null, ValidationError> {
  if (cursor === null || cursor === undefined || cursor === "") return ok(null);
  return decodeAttendanceCursor(cursor);
}

function collectIssues(parts: readonly Result<unknown, ValidationError>[]): FieldIssue[] {
  return parts.flatMap((part) => (part.ok ? [] : part.error.issues));
}

/** Checks the page size and the cursor. Every problem is reported at once. */
export function parseAttendancePage(
  input: AttendancePageInput,
): Result<AttendancePageQuery, ValidationError> {
  const limit = parseLimit(input.limit);
  const after = parseCursor(input.cursor);
  if (!limit.ok || !after.ok) {
    return validationError("Invalid page", collectIssues([limit, after]));
  }
  return ok({ limit: limit.value, after: after.value });
}

export interface MemberHistoryInput extends AttendancePageInput {
  readonly memberId: string;
}

export interface MemberHistoryQuery extends AttendancePageQuery {
  readonly memberId: string;
}

/** Checks the member id and the page of a member's attendance history. */
export function parseMemberHistory(
  input: MemberHistoryInput,
): Result<MemberHistoryQuery, ValidationError> {
  const memberId = parseUuid(input.memberId, "memberId");
  const page = parseAttendancePage(input);
  if (!memberId.ok || !page.ok) {
    return validationError("Invalid history", collectIssues([memberId, page]));
  }
  return ok({ memberId: memberId.value, ...page.value });
}

/** The first and last gym local day of a per day report, both written YYYY-MM-DD. */
export interface DayRange {
  readonly from: string;
  readonly to: string;
}

function dateIssue(field: "from" | "to", value: string): FieldIssue[] {
  return isCalendarDate(value) ? [] : [{ path: [field], message: "Use a date like 2026-11-16" }];
}

/** Checks a report range: two real dates, in order, covering at most MAX_REPORT_DAYS days. */
export function parseDayRange(input: DayRange): Result<DayRange, ValidationError> {
  const issues = [...dateIssue("from", input.from), ...dateIssue("to", input.to)];
  if (issues.length > 0) return validationError("Invalid range", issues);
  const days = daysBetween(input.from, input.to) + 1;
  if (days < 1) {
    return validationError("Invalid range", [{ path: ["to"], message: "Must not be before from" }]);
  }
  if (days > MAX_REPORT_DAYS) {
    return validationError("Invalid range", [
      { path: ["to"], message: `At most ${MAX_REPORT_DAYS} days` },
    ]);
  }
  return ok({ from: input.from, to: input.to });
}

export interface DayCount {
  readonly date: string;
  readonly visits: number;
}

/** One entry for every day of the range, with zero for a day that had no visit. */
export function fillDayCounts(range: DayRange, counted: readonly DayCount[]): DayCount[] {
  const byDate = new Map(counted.map((day) => [day.date, day.visits]));
  const days = daysBetween(range.from, range.to) + 1;
  return Array.from({ length: days }, (_, offset) => {
    const date = addDays(range.from, offset);
    return { date, visits: byDate.get(date) ?? 0 };
  });
}
