import { parseBearerToken } from "../domain/session";
import type { FindMembership } from "./gym-membership";
import type { Sessions } from "./sessions";

/** Who is calling, as one request sees it. */
export interface RequestSession {
  /** The stored session row, so the person can pick a gym or sign out. */
  readonly sessionId: string;
  /** The Google subject, the identity that spans every gym. */
  readonly subject: string;
  /** The person's user row in the bound gym. Null for an identity session. */
  readonly userId: string | null;
  /** The bound gym. Null for an identity session. */
  readonly tenantId: string | null;
}

export interface RequestSessionDeps {
  readonly sessions: Pick<Sessions, "authenticate">;
  readonly findMembership: FindMembership;
}

/**
 * Turns an Authorization header into the session of one request. A missing, unknown, expired or
 * revoked token is no session at all. The gym always comes from the stored session, and it is
 * checked again here, so a person who lost their role since they picked the gym falls back to an
 * identity session instead of keeping the gym.
 */
export function makeResolveRequestSession(deps: RequestSessionDeps) {
  return async (authorization: string | null): Promise<RequestSession | null> => {
    const token = parseBearerToken(authorization);
    if (token === null) return null;
    const authenticated = await deps.sessions.authenticate(token);
    if (!authenticated.ok) return null;
    const { sessionId, subject, gymId } = authenticated.value;
    if (gymId === null) return { sessionId, subject, userId: null, tenantId: null };
    const membership = await deps.findMembership(subject, gymId);
    if (membership === null) return { sessionId, subject, userId: null, tenantId: null };
    return { sessionId, subject, userId: membership.userId, tenantId: gymId };
  };
}
