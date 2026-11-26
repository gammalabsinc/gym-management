import { type NotFoundError, notFound } from "../domain/errors";
import { permissionsOf, type Role } from "../domain/permissions";
import { ok, type Result } from "../domain/result";
import type { WhoAmIUnit, WithTenantTx } from "./ports";

export interface WhoAmIDeps {
  readonly withUnit: WithTenantTx<WhoAmIUnit>;
}

/** A person inside one gym. Both ids come from the session, never from client input. */
export interface WhoAmICaller {
  readonly tenantId: string;
  readonly userId: string;
}

export interface Me {
  readonly userId: string;
  readonly name: string | null;
  readonly email: string;
  readonly roles: readonly Role[];
  /** Every permission the roles hold together, without repeats, in a stable order. */
  readonly permissions: readonly string[];
  readonly memberId: string | null;
}

/** Who the caller is in the gym their session is bound to, and what they may do there. */
export function makeWhoAmI(deps: WhoAmIDeps) {
  return async (_input: undefined, ctx: WhoAmICaller): Promise<Result<Me, NotFoundError>> => {
    const record = await deps.withUnit(ctx.tenantId, (unit) => unit.me.find(ctx.userId));
    if (record === null) return notFound();
    const permissions = [...new Set(record.roles.flatMap((role) => permissionsOf(role)))].sort();
    return ok({ ...record, permissions });
  };
}
