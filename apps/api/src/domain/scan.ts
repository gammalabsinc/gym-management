import { type FieldIssue, type ValidationError, validationError } from "./errors";
import { ok, type Result } from "./result";
import { parseUuid } from "./uuid";

export const SCAN_SOURCES = ["staff_app", "manual"] as const;
export type ScanSource = (typeof SCAN_SOURCES)[number];

/** Far above any real barcode, so a hostile client cannot send a huge string to the database. */
export const MAX_BARCODE_LENGTH = 64;

/** What the scanner sends. The source is left out by the staff app. */
export interface RecordScanInput {
  readonly barcode: string;
  readonly source?: string | null | undefined;
}

/** A scan ready to look up: the barcode trimmed and the source one of the allowed values. */
export interface NewScan {
  readonly barcode: string;
  readonly source: ScanSource;
}

function isScanSource(value: string): value is ScanSource {
  return SCAN_SOURCES.some((source) => source === value);
}

function barcodeIssues(barcode: string): FieldIssue[] {
  if (barcode === "") return [{ path: ["barcode"], message: "Scan or enter a barcode" }];
  return barcode.length > MAX_BARCODE_LENGTH
    ? [{ path: ["barcode"], message: `At most ${MAX_BARCODE_LENGTH} characters` }]
    : [];
}

/**
 * Checks a scan. Any text of a sensible length is a valid barcode, because a code that belongs to
 * nobody is answered with the unknown code result and not with an error, so a client cannot tell
 * a code of another gym from a random string.
 */
export function parseRecordScan(input: RecordScanInput): Result<NewScan, ValidationError> {
  const barcode = input.barcode.trim();
  const source = input.source?.trim() || "staff_app";
  const issues = [
    ...barcodeIssues(barcode),
    ...(isScanSource(source)
      ? []
      : [{ path: ["source"], message: `Use one of ${SCAN_SOURCES.join(", ")}` }]),
  ];
  return issues.length === 0 && isScanSource(source)
    ? ok({ barcode, source })
    : validationError("Invalid scan", issues);
}

/** What the check in by search sends: the member the front desk picked from the list. */
export interface CheckInInput {
  readonly memberId: string;
}

/** Checks the member id at the boundary. The source of such a check in is always manual. */
export function parseCheckIn(input: CheckInInput): Result<{ memberId: string }, ValidationError> {
  const memberId = parseUuid(input.memberId, "memberId");
  return memberId.ok
    ? ok({ memberId: memberId.value })
    : validationError("Invalid check in", memberId.error.issues);
}
