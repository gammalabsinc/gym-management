import { isCalendarDate } from "./calendar";
import { type FieldIssue, type ValidationError, validationError } from "./errors";
import { parseLimit } from "./member-list";
import { ok, type Result } from "./result";
import { parseUuid } from "./uuid";

const MAX_CURSOR_LENGTH = 128;

/** What the discounts tab shows: spent on an invoice, stopped, or still able to apply. */
export const DISCOUNT_STATUSES = ["active", "consumed", "ended"] as const;
export type DiscountStatus = (typeof DISCOUNT_STATUSES)[number];

/** A discount reduced to what its status reads. */
export interface DiscountLifecycle {
  readonly isActive: boolean;
  readonly endsOn: string | null;
  readonly consumedInvoiceId: string | null;
}

/**
 * A one time discount that landed on an invoice is consumed. A discount that was switched off, or
 * whose last day has passed, is ended. Everything else is active. `today` is the gym's local date.
 */
export function discountStatusOf(discount: DiscountLifecycle, today: string): DiscountStatus {
  if (discount.consumedInvoiceId !== null) return "consumed";
  const lapsed = discount.endsOn !== null && discount.endsOn < today;
  return discount.isActive && !lapsed ? "active" : "ended";
}

/** Where the next page starts: the date and id of the last row sent. Every ledger list runs newest first. */
export interface LedgerPosition {
  readonly date: string;
  readonly id: string;
}

/** What a ledger tab sends to read a page. */
export interface LedgerPageInput {
  readonly memberId: string;
  readonly limit?: number | null | undefined;
  readonly cursor?: string | null | undefined;
}

export interface LedgerPageQuery {
  readonly memberId: string;
  readonly limit: number;
  readonly after: LedgerPosition | null;
}

/** The cursor is opaque to clients. It is the sort key of the last row, so no offset is scanned. */
export function encodeLedgerCursor(position: LedgerPosition): string {
  return Buffer.from(JSON.stringify([position.date, position.id])).toString("base64url");
}

function badCursor(): Result<never, ValidationError> {
  return validationError("Invalid page", [{ path: ["cursor"], message: "Not a valid cursor" }]);
}

export function decodeLedgerCursor(text: string): Result<LedgerPosition, ValidationError> {
  if (text.length > MAX_CURSOR_LENGTH) return badCursor();
  let parts: unknown;
  try {
    parts = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    return badCursor();
  }
  if (!Array.isArray(parts) || parts.length !== 2) return badCursor();
  const [date, id] = parts as unknown[];
  if (typeof date !== "string" || typeof id !== "string" || !isCalendarDate(date)) {
    return badCursor();
  }
  const uuid = parseUuid(id, "cursor");
  return uuid.ok ? ok({ date, id: uuid.value }) : badCursor();
}

function parseCursor(
  cursor: string | null | undefined,
): Result<LedgerPosition | null, ValidationError> {
  if (cursor === null || cursor === undefined || cursor === "") return ok(null);
  return decodeLedgerCursor(cursor);
}

function issuesOf(parts: readonly Result<unknown, ValidationError>[]): FieldIssue[] {
  return parts.flatMap((part) => (part.ok ? [] : part.error.issues));
}

/** Checks the member id, the page size and the cursor. The size is capped, and every problem is reported at once. */
export function parseLedgerPage(input: LedgerPageInput): Result<LedgerPageQuery, ValidationError> {
  const memberId = parseUuid(input.memberId, "memberId");
  const limit = parseLimit(input.limit);
  const after = parseCursor(input.cursor);
  if (!memberId.ok || !limit.ok || !after.ok) {
    return validationError("Invalid page", issuesOf([memberId, limit, after]));
  }
  return ok({ memberId: memberId.value, limit: limit.value, after: after.value });
}
