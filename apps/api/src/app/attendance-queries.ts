import {
  type AttendancePageInput,
  type DayCount,
  type DayRange,
  encodeAttendanceCursor,
  fillDayCounts,
  type MemberHistoryInput,
  parseAttendancePage,
  parseDayRange,
  parseMemberHistory,
} from "../domain/attendance-query";
import { localDateIn } from "../domain/calendar";
import { type NotFoundError, notFound, type ValidationError } from "../domain/errors";
import { monthWindows } from "../domain/member-list";
import { ok } from "../domain/result";
import type { Tenant } from "../domain/tenant";
import type {
  AttendancePageRequest,
  AttendanceQueryUnit,
  AttendanceRecord,
  Clock,
  MonthVisits,
  WithTenantTx,
} from "./ports";
import { type PermissionContext, requirePermission } from "./require-permission";

export interface AttendanceQueryDeps {
  readonly withUnit: WithTenantTx<AttendanceQueryUnit>;
  readonly clock: Clock;
}

/** The gym comes from the session, never from client input. */
export interface AttendanceCaller extends PermissionContext {
  readonly tenantId: string;
}

export interface AttendancePage {
  readonly items: readonly AttendanceRecord[];
  /** Null on the last page. */
  readonly nextCursor: string | null;
}

async function readTenant(unit: AttendanceQueryUnit): Promise<Tenant> {
  const tenant = await unit.tenants.find();
  if (tenant === null) throw new Error("The gym of this transaction cannot be read");
  return tenant;
}

/**
 * Cuts one extra row off a page that was read with limit + 1, which is how a next page is known
 * to exist without a count.
 */
function toPage(rows: readonly AttendanceRecord[], limit: number): AttendancePage {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const hasMore = rows.length > limit && last !== undefined;
  return {
    items,
    nextCursor: hasMore ? encodeAttendanceCursor({ scannedAt: last.scannedAt, id: last.id }) : null,
  };
}

function oneMore(page: AttendancePageRequest): AttendancePageRequest {
  return { limit: page.limit + 1, after: page.after };
}

/**
 * A member's check ins, newest first, with repeat scans marked so staff can see them. Staff and
 * owners only. A member's own view of the same rows, without repeats, is a separate use case.
 */
export function makeMemberHistory(deps: AttendanceQueryDeps) {
  return requirePermission<
    MemberHistoryInput,
    AttendanceCaller,
    AttendancePage,
    ValidationError | NotFoundError
  >("member.read", async (input, ctx) => {
    const parsed = parseMemberHistory(input);
    if (!parsed.ok) return parsed;
    const { memberId, limit, after } = parsed.value;
    return deps.withUnit(ctx.tenantId, async (unit) => {
      if (!(await unit.attendance.memberExists(memberId))) return notFound("Member not found");
      const rows = await unit.attendance.history(memberId, oneMore({ limit, after }), true);
      return ok(toPage(rows, limit));
    });
  });
}

/**
 * Visits this month and last month by the gym's calendar, so a scan late on the last evening of a
 * month stays in that month for a gym west of UTC. Repeat scans never count.
 */
export function makeMemberVisitCounts(deps: AttendanceQueryDeps) {
  return requirePermission<
    { readonly memberId: string },
    AttendanceCaller,
    MonthVisits,
    ValidationError | NotFoundError
  >("member.read", async (input, ctx) => {
    const parsed = parseMemberHistory({ memberId: input.memberId });
    if (!parsed.ok) return parsed;
    const { memberId } = parsed.value;
    return deps.withUnit(ctx.tenantId, async (unit) => {
      const tenant = await readTenant(unit);
      if (!(await unit.attendance.memberExists(memberId))) return notFound("Member not found");
      const months = monthWindows(localDateIn(deps.clock.now(), tenant.timezone));
      return ok(
        await unit.attendance.monthVisits(
          memberId,
          months.lastStart,
          months.thisStart,
          months.nextStart,
        ),
      );
    });
  });
}

/** Everyone who scanned today by the gym's calendar, newest first, repeat scans marked. */
export function makeTodaysAttendance(deps: AttendanceQueryDeps) {
  return requirePermission<AttendancePageInput, AttendanceCaller, AttendancePage, ValidationError>(
    "member.read",
    async (input, ctx) => {
      const parsed = parseAttendancePage(input);
      if (!parsed.ok) return parsed;
      return deps.withUnit(ctx.tenantId, async (unit) => {
        const tenant = await readTenant(unit);
        const today = localDateIn(deps.clock.now(), tenant.timezone);
        const rows = await unit.attendance.onDay(today, oneMore(parsed.value));
        return ok(toPage(rows, parsed.value.limit));
      });
    },
  );
}

/** Visits per day for the owner's reports. Every day of the range is listed, repeat scans never count. */
export function makeDailyVisitCounts(deps: AttendanceQueryDeps) {
  return requirePermission<DayRange, AttendanceCaller, readonly DayCount[], ValidationError>(
    "report.read",
    async (input, ctx) => {
      const parsed = parseDayRange(input);
      if (!parsed.ok) return parsed;
      const range = parsed.value;
      return deps.withUnit(ctx.tenantId, async (unit) =>
        ok(fillDayCounts(range, await unit.attendance.dailyCounts(range.from, range.to))),
      );
    },
  );
}
