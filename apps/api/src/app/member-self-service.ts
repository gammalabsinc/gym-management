import {
  type AttendancePageInput,
  encodeAttendanceCursor,
  parseAttendancePage,
} from "../domain/attendance-query";
import type { NotFoundError, ValidationError } from "../domain/errors";
import { notFound } from "../domain/errors";
import {
  groupVisitsByMonth,
  type MemberCard,
  type MemberProfile,
  toMemberCard,
  toMemberProfile,
  type VisitMonth,
} from "../domain/member-self";
import { ok, type Result } from "../domain/result";
import type { Tenant } from "../domain/tenant";
import { memberQueryContext } from "./member-queries";
import type { Clock, MemberSelfServiceUnit, MonthVisits, WithTenantTx } from "./ports";
import { type PermissionContext, requirePermission } from "./require-permission";

export interface MemberSelfServiceDeps {
  readonly withUnit: WithTenantTx<MemberSelfServiceUnit>;
  readonly clock: Clock;
}

/**
 * Who is asking. Both come from the session, never from client input, and no use case here takes a
 * member id, so a member can only ever read the record that belongs to their own user.
 */
export interface MemberSelfCaller extends PermissionContext {
  readonly tenantId: string;
  readonly userId: string;
}

export interface MyAttendance {
  readonly visitsThisMonth: number;
  readonly visitsLastMonth: number;
  /** Visits newest first, grouped by the gym's calendar month. Repeat scans are left out. */
  readonly months: readonly VisitMonth[];
  /** Null on the last page. */
  readonly nextCursor: string | null;
}

const PERMISSION = "member.read.own";
const MEMBER_NOT_FOUND = "Member not found";

async function readTenant(unit: MemberSelfServiceUnit): Promise<Tenant> {
  const tenant = await unit.tenants.find();
  if (tenant === null) throw new Error("The gym of this transaction cannot be read");
  return tenant;
}

/** The member of the calling user, or the not found answer. A user who is not a member gets nothing. */
async function ownMemberId(
  unit: MemberSelfServiceUnit,
  ctx: MemberSelfCaller,
): Promise<Result<string, NotFoundError>> {
  const memberId = await unit.self.memberIdOfUser(ctx.userId);
  return memberId === null ? notFound(MEMBER_NOT_FOUND) : ok(memberId);
}

/** The card: gym name and colour, the code for the QR, member number, name, standing, status and paid through. */
export function makeGetMyCard(deps: MemberSelfServiceDeps) {
  return requirePermission<undefined, MemberSelfCaller, MemberCard, NotFoundError>(
    PERMISSION,
    async (_input, ctx) =>
      deps.withUnit(ctx.tenantId, async (unit) => {
        const memberId = await ownMemberId(unit, ctx);
        if (!memberId.ok) return memberId;
        const tenant = await readTenant(unit);
        const member = await unit.members.find(
          memberId.value,
          memberQueryContext(tenant, deps.clock.now()),
        );
        return member === null ? notFound(MEMBER_NOT_FOUND) : ok(toMemberCard(member, tenant));
      }),
  );
}

/** The profile: name, email, plan, member number and joined date. Read only. */
export function makeGetMyProfile(deps: MemberSelfServiceDeps) {
  return requirePermission<undefined, MemberSelfCaller, MemberProfile, NotFoundError>(
    PERMISSION,
    async (_input, ctx) =>
      deps.withUnit(ctx.tenantId, async (unit) => {
        const memberId = await ownMemberId(unit, ctx);
        if (!memberId.ok) return memberId;
        const tenant = await readTenant(unit);
        const member = await unit.members.find(
          memberId.value,
          memberQueryContext(tenant, deps.clock.now()),
        );
        return member === null ? notFound(MEMBER_NOT_FOUND) : ok(toMemberProfile(member));
      }),
  );
}

function monthsOf(visits: MonthVisits): Pick<MyAttendance, "visitsThisMonth" | "visitsLastMonth"> {
  return { visitsThisMonth: visits.thisMonth, visitsLastMonth: visits.lastMonth };
}

/**
 * Visit counts for this month and last month, and the visits grouped by month with day and time.
 * Repeat scans are left out of both. The history is paged the same way staff pages are.
 */
export function makeGetMyAttendance(deps: MemberSelfServiceDeps) {
  return requirePermission<
    AttendancePageInput,
    MemberSelfCaller,
    MyAttendance,
    ValidationError | NotFoundError
  >(PERMISSION, async (input, ctx) => {
    const parsed = parseAttendancePage(input);
    if (!parsed.ok) return parsed;
    const { limit, after } = parsed.value;
    return deps.withUnit(ctx.tenantId, async (unit) => {
      const memberId = await ownMemberId(unit, ctx);
      if (!memberId.ok) return memberId;
      const tenant = await readTenant(unit);
      const window = memberQueryContext(tenant, deps.clock.now());
      const counts = await unit.attendance.monthVisits(
        memberId.value,
        window.lastMonthStart,
        window.thisMonthStart,
        window.nextMonthStart,
      );
      const rows = await unit.attendance.history(
        memberId.value,
        { limit: limit + 1, after },
        false,
      );
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      const hasMore = rows.length > limit && last !== undefined;
      return ok({
        ...monthsOf(counts),
        months: groupVisitsByMonth(items, tenant.timezone),
        nextCursor: hasMore
          ? encodeAttendanceCursor({ scannedAt: last.scannedAt, id: last.id })
          : null,
      });
    });
  });
}
