import { type ForbiddenError, forbidden, type NotFoundError, notFound } from "../domain/errors";
import type { GymSummary } from "../domain/gym-picker";
import { ok, type Result } from "../domain/result";
import { parseUuid } from "../domain/uuid";
import type { FindMembership } from "./gym-membership";
import type { GymRegistry, SessionStore } from "./ports";

export const NOT_A_MEMBER_MESSAGE = "You are not a member of this gym";

export interface SelectGymDeps {
  readonly gyms: GymRegistry;
  readonly findMembership: FindMembership;
  readonly sessions: Pick<SessionStore, "bindGym">;
}

export interface SelectGymInput {
  readonly tenantId: string;
}

/** The session that is picking a gym. It carries the person's identity and no gym yet. */
export interface SelectGymContext {
  readonly sessionId: string;
  readonly subject: string;
}

/**
 * Binds the session to one gym. The person must hold a role there, and from then on every
 * request takes its tenant from the session and from nothing the client sends. An id that is not
 * a gym, or a gym that is switched off, is a generic not found. A gym that is there but where the
 * person holds no role is a forbidden error, and nothing about the gym is returned with it.
 */
export function makeSelectGym(deps: SelectGymDeps) {
  return async (
    input: SelectGymInput,
    ctx: SelectGymContext,
  ): Promise<Result<GymSummary, NotFoundError | ForbiddenError>> => {
    const id = parseUuid(input.tenantId, "tenantId");
    if (!id.ok) return notFound();
    if (!(await deps.gyms.isActive(id.value))) return notFound();
    const membership = await deps.findMembership(ctx.subject, id.value);
    if (membership === null) return forbidden(NOT_A_MEMBER_MESSAGE);
    await deps.sessions.bindGym(ctx.sessionId, id.value);
    return ok(membership.gym);
  };
}
