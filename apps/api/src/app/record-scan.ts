import { localDateIn } from "../domain/calendar";
import type { ValidationError } from "../domain/errors";
import { ok, type Result } from "../domain/result";
import type { ScanSource } from "../domain/scan";
import { parseRecordScan, type RecordScanInput } from "../domain/scan";
import type { MembershipStatus, Standing } from "../domain/standing";
import { memberQueryContext } from "./member-queries";
import type { Clock, ScanUnit, WithTenantTx } from "./ports";
import { type PermissionContext, requirePermission } from "./require-permission";

export interface RecordScanDeps {
  readonly withUnit: WithTenantTx<ScanUnit>;
  readonly clock: Clock;
}

/** The gym comes from the session, never from client input. */
export interface RecordScanContext extends PermissionContext {
  readonly tenantId: string;
}

/** The scan that was stored. */
export interface ScannedVisit {
  readonly id: string;
  readonly memberId: string;
  /** An instant in UTC. */
  readonly scannedAt: string;
  /** The scan day in the gym's time zone, written YYYY-MM-DD. */
  readonly localDate: string;
  readonly isDuplicate: boolean;
  readonly statusAtScan: Standing;
  readonly source: ScanSource;
}

/** What the result card shows about the member. */
export interface ScannedMember {
  readonly id: string;
  readonly name: string | null;
  readonly standing: Standing;
  /** Null for a new member who has not paid anything. */
  readonly paidThrough: string | null;
  readonly status: MembershipStatus;
  /** The gym's local date the member was paused or cancelled. Null while the member is active. */
  readonly statusChangedOn: string | null;
}

/** A code that belongs to nobody in this gym. It says nothing about any other gym. */
export interface UnknownCode {
  readonly found: false;
}

export interface RecognizedScan {
  readonly found: true;
  readonly visit: ScannedVisit;
  readonly member: ScannedMember;
  /** When the check in that this scan repeats happened, a UTC instant. Null unless the scan is a duplicate. */
  readonly firstCheckInAt: string | null;
}

export type ScanOutcome = RecognizedScan | UnknownCode;

const UNKNOWN_CODE: UnknownCode = { found: false };

/**
 * Stores a check in. The member row is locked first, so two scans of one member take turns and
 * the second one sees the first, which is what makes exactly one of two simultaneous scans the
 * original. A scan is a duplicate when the member's last original scan is inside the gym's
 * window. Standing is recorded and shown but never refuses a scan, and a barcode of another gym
 * gets the same answer as a random string. The attendance row is the record, so no audit event
 * is written.
 */
export function makeRecordScan(deps: RecordScanDeps) {
  return requirePermission<RecordScanInput, RecordScanContext, ScanOutcome, ValidationError>(
    "scan.record",
    async (input, ctx) => {
      const parsed = parseRecordScan(input);
      if (!parsed.ok) return parsed;
      const scan = parsed.value;
      return deps.withUnit(ctx.tenantId, async (unit): Promise<Result<ScanOutcome, never>> => {
        const tenant = await unit.tenants.find();
        if (tenant === null) throw new Error("The gym of this transaction cannot be read");
        const found = await unit.scans.lockByBarcode(scan.barcode);
        if (found === null) return ok(UNKNOWN_CODE);

        const now = deps.clock.now();
        const view = await unit.members.find(found.id, memberQueryContext(tenant, now));
        if (view === null) throw new Error("A locked member cannot be read");

        const firstCheckInAt = await unit.scans.originalScanWithin(
          found.id,
          now,
          tenant.settings.dupWindowMin,
        );
        const isDuplicate = firstCheckInAt !== null;
        const localDate = localDateIn(now, tenant.timezone);
        const id = await unit.scans.insert({
          memberId: found.id,
          scannedAt: now,
          localDate,
          isDuplicate,
          statusAtScan: view.standing,
          source: scan.source,
        });
        return ok({
          found: true,
          visit: {
            id,
            memberId: found.id,
            scannedAt: now.toISOString(),
            localDate,
            isDuplicate,
            statusAtScan: view.standing,
            source: scan.source,
          },
          member: {
            id: found.id,
            name: view.name,
            standing: view.standing,
            paidThrough: view.paidThrough,
            status: found.status,
            statusChangedOn: found.status === "active" ? null : found.statusSince,
          },
          firstCheckInAt,
        });
      });
    },
  );
}
