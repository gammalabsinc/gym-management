import { type NotFoundError, notFound, type ValidationError } from "../domain/errors";
import {
  type MemberProfileEditInput,
  type ProfileChange,
  parseProfileEdit,
} from "../domain/member";
import { ok, type Result } from "../domain/result";
import type { MemberProfile, ProfileUnit, WithTenantTx } from "./ports";
import { type PermissionContext, requirePermission } from "./require-permission";

export const MEMBER_UPDATED = "member.updated";

export interface EditMemberDeps {
  readonly withUnit: WithTenantTx<ProfileUnit>;
}

/** The tenant, the caller and the request all come from the session, never from client input. */
export interface EditMemberContext extends PermissionContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly requestId: string;
}

export interface EditedMember {
  readonly memberId: string;
  readonly name: string | null;
  readonly phone: string | null;
  /** False when every sent value was already what is stored, so nothing was written. */
  readonly changed: boolean;
}

type EditError = ValidationError | NotFoundError;

/** Only the fields that were sent and differ from what is stored. */
function effectiveChange(current: MemberProfile, change: ProfileChange): ProfileChange {
  return {
    ...(change.name !== undefined && change.name !== current.name ? { name: change.name } : {}),
    ...(change.phone !== undefined && change.phone !== current.phone
      ? { phone: change.phone }
      : {}),
  };
}

function snapshot(profile: MemberProfile, fields: ProfileChange) {
  return {
    ...(fields.name !== undefined ? { name: profile.name } : {}),
    ...(fields.phone !== undefined ? { phone: profile.phone } : {}),
  };
}

/**
 * Edits the name and phone of a member. The allow list is checked in the domain, so member_no,
 * barcode, email, plan, join date and referrer can never change here. The member's user row is
 * locked while it is read and written. An edit that changes nothing writes nothing, not even an
 * audit event. The change and its audit event commit together.
 */
export function makeEditMember(deps: EditMemberDeps) {
  return requirePermission<MemberProfileEditInput, EditMemberContext, EditedMember, EditError>(
    "member.update",
    async (input, ctx) => {
      const parsed = parseProfileEdit(input);
      if (!parsed.ok) return parsed;
      const { memberId, change } = parsed.value;
      return deps.withUnit(ctx.tenantId, async (unit): Promise<Result<EditedMember, EditError>> => {
        const current = await unit.profiles.lock(memberId);
        if (current === null) return notFound("Member not found");
        const effective = effectiveChange(current, change);
        const next = {
          name: effective.name ?? current.name,
          phone: effective.phone === undefined ? current.phone : effective.phone,
        };
        if (Object.keys(effective).length === 0) return ok({ memberId, ...next, changed: false });

        await unit.profiles.update(current.userId, effective);
        await unit.audit.record({
          actorUserId: ctx.userId,
          action: MEMBER_UPDATED,
          entityType: "member",
          entityId: memberId,
          before: snapshot(current, effective),
          after: { ...effective },
          requestId: ctx.requestId,
        });
        return ok({ memberId, ...next, changed: true });
      });
    },
  );
}
