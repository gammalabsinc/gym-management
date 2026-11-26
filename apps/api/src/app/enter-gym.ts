import { type ForbiddenError, type NotFoundError, notFound } from "../domain/errors";
import { ok, type Result } from "../domain/result";
import type { FindMembership } from "./gym-membership";
import type { makeSelectGym, SelectGymContext } from "./select-gym";
import type { makeGetTenant, TenantView } from "./tenant-settings";
import type { Me, makeWhoAmI } from "./who-am-i";

export interface EnterGymDeps {
  readonly selectGym: ReturnType<typeof makeSelectGym>;
  readonly findMembership: FindMembership;
  readonly whoAmI: ReturnType<typeof makeWhoAmI>;
  readonly getTenant: ReturnType<typeof makeGetTenant>;
  readonly newRequestId: () => string;
}

export interface EnteredGym {
  readonly me: Me;
  readonly tenant: TenantView;
}

/**
 * Binds the session to a gym, then reads who the person is there and the gym's profile, so the
 * app can show the right view in the same round trip. Everything after the bind runs in the
 * gym's own tenant transaction.
 */
export function makeEnterGym(deps: EnterGymDeps) {
  return async (
    input: { readonly tenantId: string },
    ctx: SelectGymContext,
  ): Promise<Result<EnteredGym, NotFoundError | ForbiddenError>> => {
    const selected = await deps.selectGym(input, ctx);
    if (!selected.ok) return selected;
    const { tenantId } = selected.value;
    const membership = await deps.findMembership(ctx.subject, tenantId);
    if (membership === null) return notFound();
    const caller = { tenantId, userId: membership.userId };
    const me = await deps.whoAmI(undefined, caller);
    if (!me.ok) return me;
    const tenant = await deps.getTenant(undefined, {
      ...caller,
      roles: me.value.roles,
      requestId: deps.newRequestId(),
    });
    if (!tenant.ok) return tenant;
    return ok({ me: me.value, tenant: tenant.value });
  };
}
