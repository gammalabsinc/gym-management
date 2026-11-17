import { localDateIn } from "../domain/calendar";
import { type NotFoundError, notFound, type ValidationError } from "../domain/errors";
import { ok, type Result } from "../domain/result";
import {
  type CheckInInput,
  parseCheckIn,
  parseRecordScan,
  type RecordScanInput,
  type ScanSource,
} from "../domain/scan";
import type { MembershipStatus, Standing } from "../domain/standing";
import type { Tenant } from "../domain/tenant";
import { memberQueryContext } from "./member-queries";
import type { Clock, ScanMember, ScanUnit, WithTenantTx } from "./ports";
import { type PermissionContext, requirePermission } from "./require-permission";

export interface RecordScanDeps {
  readonly withUnit: WithTenantTx<ScanUnit>;
  readonly clock: Clock;
}

/** The gym and the staff user come from the session, never from client input. */
export interface RecordScanContext extends PermissionContext {
  readonly tenantId: string;
  readonly userId: string;
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

async function readTenant(unit: ScanUnit): Promise<Tenant> {
  const tenant = await unit.tenants.find();
  if (tenant === null) throw new Error("The gym of this transaction cannot be read");
  return tenant;
}

/**
 * Stores the check in of a member whose row is already locked, and builds the result card. Both
 * ways of checking in end here, so they share one repeat scan window and one standing. A repeat
 * is judged against the member's last original check in whichever way it was made. Standing is
 * recorded and shown but never refuses a check in.
 */
async function storeVisit(
  deps: RecordScanDeps,
  unit: ScanUnit,
  tenant: Tenant,
  member: ScanMember,
  how: { readonly source: ScanSource; readonly recordedBy: string },
): Promise<RecognizedScan> {
  const now = deps.clock.now();
  const view = await unit.members.find(member.id, memberQueryContext(tenant, now));
  if (view === null) throw new Error("A locked member cannot be read");

  const firstCheckInAt = await unit.scans.originalScanWithin(
    member.id,
    now,
    tenant.settings.dupWindowMin,
  );
  const isDuplicate = firstCheckInAt !== null;
  const localDate = localDateIn(now, tenant.timezone);
  const id = await unit.scans.insert({
    memberId: member.id,
    scannedAt: now,
    localDate,
    isDuplicate,
    statusAtScan: view.standing,
    source: how.source,
    recordedBy: how.recordedBy,
  });
  return {
    found: true,
    visit: {
      id,
      memberId: member.id,
      scannedAt: now.toISOString(),
      localDate,
      isDuplicate,
      statusAtScan: view.standing,
      source: how.source,
    },
    member: {
      id: member.id,
      name: view.name,
      standing: view.standing,
      paidThrough: view.paidThrough,
      status: member.status,
      statusChangedOn: member.status === "active" ? null : member.statusSince,
    },
    firstCheckInAt,
  };
}

/**
 * Stores a check in from a barcode. The member row is locked first, so two scans of one member
 * take turns and the second one sees the first, which is what makes exactly one of two
 * simultaneous scans the original. A barcode of another gym gets the same answer as a random
 * string. The attendance row is the record, so no audit event is written.
 */
export function makeRecordScan(deps: RecordScanDeps) {
  return requirePermission<RecordScanInput, RecordScanContext, ScanOutcome, ValidationError>(
    "scan.record",
    async (input, ctx) => {
      const parsed = parseRecordScan(input);
      if (!parsed.ok) return parsed;
      const scan = parsed.value;
      return deps.withUnit(ctx.tenantId, async (unit): Promise<Result<ScanOutcome, never>> => {
        const tenant = await readTenant(unit);
        const found = await unit.scans.lockByBarcode(scan.barcode);
        if (found === null) return ok(UNKNOWN_CODE);
        return ok(
          await storeVisit(deps, unit, tenant, found, {
            source: scan.source,
            recordedBy: ctx.userId,
          }),
        );
      });
    },
  );
}

/**
 * Checks a member in by id, for the front desk that picked them from search because the card is
 * lost or the camera is off. It gives the same result card and applies the same rules as a
 * barcode scan, with the source always manual and the staff user recorded. The id must belong
 * to the session gym, and an id of another gym gets the same answer as an unknown one.
 */
export function makeCheckInMember(deps: RecordScanDeps) {
  return requirePermission<
    CheckInInput,
    RecordScanContext,
    RecognizedScan,
    ValidationError | NotFoundError
  >("scan.record", async (input, ctx) => {
    const parsed = parseCheckIn(input);
    if (!parsed.ok) return parsed;
    return deps.withUnit(
      ctx.tenantId,
      async (unit): Promise<Result<RecognizedScan, NotFoundError>> => {
        const tenant = await readTenant(unit);
        const found = await unit.scans.lockById(parsed.value.memberId);
        if (found === null) return notFound("Member not found");
        return ok(
          await storeVisit(deps, unit, tenant, found, {
            source: "manual",
            recordedBy: ctx.userId,
          }),
        );
      },
    );
  });
}
