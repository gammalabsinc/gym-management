import { localDateIn } from "../domain/calendar";
import { type NotFoundError, notFound, type ValidationError } from "../domain/errors";
import {
  encodeCursor,
  type MemberListInput,
  monthWindows,
  parseMemberList,
  STANDING_RANK,
} from "../domain/member-list";
import type { MemberView } from "../domain/member-view";
import { ok } from "../domain/result";
import type { Tenant } from "../domain/tenant";
import { parseUuid } from "../domain/uuid";
import type { Clock, MemberQueryContext, MemberQueryUnit, WithTenantTx } from "./ports";
import { type PermissionContext, requirePermission } from "./require-permission";

export interface MemberQueryDeps {
  readonly withUnit: WithTenantTx<MemberQueryUnit>;
  readonly clock: Clock;
}

/** The gym comes from the session, never from client input. */
export interface MemberQueryCaller extends PermissionContext {
  readonly tenantId: string;
}

export interface MemberPage {
  readonly items: readonly MemberView[];
  /** Null on the last page. */
  readonly nextCursor: string | null;
}

/** The gym's clock settings and month boundaries, so every derived field is read the same way. */
export function memberQueryContext(tenant: Tenant, now: Date): MemberQueryContext {
  const today = localDateIn(now, tenant.timezone);
  const months = monthWindows(today);
  return {
    today,
    warnDaysBefore: tenant.settings.warnDaysBefore,
    redDaysAfter: tenant.settings.redDaysAfter,
    lastMonthStart: months.lastStart,
    thisMonthStart: months.thisStart,
    nextMonthStart: months.nextStart,
  };
}

/** Reads the gym's clock settings once, so the list and the profile derive fields the same way. */
async function queryContext(unit: MemberQueryUnit, clock: Clock): Promise<MemberQueryContext> {
  const tenant = await unit.tenants.find();
  if (tenant === null) throw new Error("The gym of this transaction cannot be read");
  return memberQueryContext(tenant, clock.now());
}

/** One member with the derived fields of the profile screen. Staff and owners only. */
export function makeGetMember(deps: MemberQueryDeps) {
  return requirePermission<
    { readonly memberId: string },
    MemberQueryCaller,
    MemberView,
    ValidationError | NotFoundError
  >("member.read", async (input, ctx) => {
    const memberId = parseUuid(input.memberId, "memberId");
    if (!memberId.ok) return memberId;
    return deps.withUnit(ctx.tenantId, async (unit) => {
      const context = await queryContext(unit, deps.clock);
      const member = await unit.members.find(memberId.value, context);
      return member === null ? notFound("Member not found") : ok(member);
    });
  });
}

/**
 * A page of members, overdue first and then by name. The page size has a hard maximum and the
 * cursor is the sort key of the last row, so deep pages cost the same as the first. The search is
 * length capped here and passed to the database as a parameter.
 */
export function makeListMembers(deps: MemberQueryDeps) {
  return requirePermission<MemberListInput, MemberQueryCaller, MemberPage, ValidationError>(
    "member.read",
    async (input, ctx) => {
      const parsed = parseMemberList(input);
      if (!parsed.ok) return parsed;
      const { search, limit, after } = parsed.value;
      return deps.withUnit(ctx.tenantId, async (unit) => {
        const context = await queryContext(unit, deps.clock);
        const rows = await unit.members.list({ search, limit: limit + 1, after }, context);
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        const hasMore = rows.length > limit && last !== undefined;
        return ok({
          items: page.map((row) => row.member),
          nextCursor: hasMore
            ? encodeCursor({
                rank: STANDING_RANK[last.member.standing],
                sortName: last.sortName,
                id: last.member.id,
              })
            : null,
        });
      });
    },
  );
}
