import { localDateIn } from "../domain/calendar";
import {
  type ConflictError,
  type NotFoundError,
  notFound,
  type ValidationError,
} from "../domain/errors";
import {
  effectiveDate,
  type MembershipAction,
  type MembershipChangeInput,
  nextStatus,
  parseReason,
} from "../domain/membership";
import { ok, type Result } from "../domain/result";
import { parseUuid } from "../domain/uuid";
import type { Clock, MembershipUnit, WithTenantTx } from "./ports";
import { type PermissionContext, requirePermission } from "./require-permission";

export interface ChangeMembershipDeps {
  readonly withUnit: WithTenantTx<MembershipUnit>;
  readonly clock: Clock;
}

/** The tenant, the caller and the request all come from the session, never from client input. */
export interface ChangeMembershipContext extends PermissionContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly requestId: string;
}

export interface ChangedMembership {
  readonly memberId: string;
  readonly status: "active" | "paused" | "cancelled";
  /** The day the new period began. */
  readonly effectiveFrom: string;
}

type ChangeError = ValidationError | NotFoundError | ConflictError;

export const MEMBERSHIP_AUDIT_ACTIONS: Readonly<Record<MembershipAction, string>> = {
  pause: "member.paused",
  resume: "member.resumed",
  cancel: "member.cancelled",
};

function parseChange(
  input: MembershipChangeInput,
): Result<{ memberId: string; reason: string }, ValidationError> {
  const memberId = parseUuid(input.memberId, "memberId");
  if (!memberId.ok) return memberId;
  const reason = parseReason(input.reason);
  if (!reason.ok) return reason;
  return ok({ memberId: memberId.value, reason: reason.value });
}

/**
 * Closes the member's current period and opens the next one with the new status, reason required.
 * The member row is locked first, so a pause and a cancel at the same moment take turns: the
 * second one reads the status the first one left, and the database allows one current row only.
 * The period rows and the audit event commit together or not at all.
 */
function changeMembership(action: MembershipAction, deps: ChangeMembershipDeps) {
  return (
    input: MembershipChangeInput,
    ctx: ChangeMembershipContext,
  ): Promise<Result<ChangedMembership, ChangeError>> => {
    const parsed = parseChange(input);
    if (!parsed.ok) return Promise.resolve(parsed);
    const { memberId, reason } = parsed.value;
    return deps.withUnit(
      ctx.tenantId,
      async (unit): Promise<Result<ChangedMembership, ChangeError>> => {
        const tenant = await unit.tenants.find();
        if (tenant === null) throw new Error("The gym of this transaction cannot be read");
        const current = await unit.periods.lockCurrent(memberId);
        if (current === null) return notFound("Member not found");
        const status = nextStatus(action, current.status);
        if (!status.ok) return status;

        const effectiveFrom = effectiveDate(
          localDateIn(deps.clock.now(), tenant.timezone),
          current.validFrom,
        );
        await unit.periods.close(current.id, effectiveFrom);
        await unit.periods.open({
          memberId,
          planId: current.planId,
          status: status.value,
          validFrom: effectiveFrom,
          reason,
          changedBy: ctx.userId,
        });
        await unit.audit.record({
          actorUserId: ctx.userId,
          action: MEMBERSHIP_AUDIT_ACTIONS[action],
          entityType: "member",
          entityId: memberId,
          before: { status: current.status, validFrom: current.validFrom },
          after: { status: status.value, validFrom: effectiveFrom, reason },
          requestId: ctx.requestId,
        });
        return ok({ memberId, status: status.value, effectiveFrom });
      },
    );
  };
}

/** Staff and owners may pause an active membership. */
export function makePauseMember(deps: ChangeMembershipDeps) {
  return requirePermission("member.pause", changeMembership("pause", deps));
}

/** Staff and owners may resume a paused membership. */
export function makeResumeMember(deps: ChangeMembershipDeps) {
  return requirePermission("member.pause", changeMembership("resume", deps));
}

/** Only the owner may cancel. */
export function makeCancelMember(deps: ChangeMembershipDeps) {
  return requirePermission("member.cancel", changeMembership("cancel", deps));
}
