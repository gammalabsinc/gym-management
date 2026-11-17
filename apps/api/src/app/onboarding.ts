import type { ValidationError } from "../domain/errors";
import { type OnboardGymInput, parseNewGym } from "../domain/onboarding";
import { ok, type Result } from "../domain/result";
import { seedPlan } from "./plans";
import type { IdGenerator, OnboardUnit, WithTenantTx } from "./ports";

export interface OnboardDeps {
  readonly withUnit: WithTenantTx<OnboardUnit>;
  readonly ids: IdGenerator;
}

/** The onboarding job has no session, so the only context is the id that ties its audit events. */
export interface OnboardContext {
  readonly requestId: string;
}

export interface OnboardedGym {
  /** The gym id, which is also the public tenant id. */
  readonly tenantId: string;
  readonly subdomain: string;
  /** False when the subdomain already belonged to a gym and nothing was written. */
  readonly created: boolean;
}

export const TENANT_CREATED = "tenant.created";
export const ROLE_ASSIGNED = "role.assigned";

/**
 * Adds a gym: its row with the default settings, its first owner and its default plan, all in one
 * transaction with their audit events, so a gym is never left half made. The subdomain is the
 * handle that makes it repeatable: running it again for a subdomain that is taken writes nothing
 * and reports the gym that is there. The new gym's id is chosen here, because the transaction
 * must be scoped to it before its first row exists.
 */
export function makeOnboardGym(deps: OnboardDeps) {
  return async (
    input: OnboardGymInput,
    ctx: OnboardContext,
  ): Promise<Result<OnboardedGym, ValidationError>> => {
    const parsed = parseNewGym(input);
    if (!parsed.ok) return parsed;
    const gym = parsed.value;
    const tenantId = deps.ids.next();
    return ok(
      await deps.withUnit(tenantId, async (unit): Promise<OnboardedGym> => {
        const inserted = await unit.gyms.insertIfAbsent({ id: tenantId, ...gym });
        if (!inserted) {
          const existing = await unit.gyms.findIdBySubdomain(gym.subdomain);
          if (existing === null) throw new Error("The gym exists but cannot be read");
          return { tenantId: existing, subdomain: gym.subdomain, created: false };
        }
        const ownerId = await unit.staff.createUser({
          email: gym.owner.email,
          name: gym.owner.name,
        });
        if (ownerId === null) throw new Error("A gym that was just created already has a user");
        await unit.staff.addRole(ownerId, gym.owner.role);
        await seedPlan(unit, gym.plan, ctx.requestId);
        await unit.audit.record({
          actorUserId: null,
          action: TENANT_CREATED,
          entityType: "tenant",
          entityId: tenantId,
          before: null,
          after: {
            name: gym.name,
            subdomain: gym.subdomain,
            timezone: gym.timezone,
            currency: gym.currency,
          },
          requestId: ctx.requestId,
        });
        await unit.audit.record({
          actorUserId: null,
          action: ROLE_ASSIGNED,
          entityType: "user",
          entityId: ownerId,
          before: null,
          after: { email: gym.owner.email, name: gym.owner.name, roles: [gym.owner.role] },
          requestId: ctx.requestId,
        });
        return { tenantId, subdomain: gym.subdomain, created: true };
      }),
    );
  };
}
