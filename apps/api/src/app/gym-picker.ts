import { type UnauthenticatedError, unauthenticated } from "../domain/errors";
import { type GymSummary, sortGyms } from "../domain/gym-picker";
import { ok, type Result } from "../domain/result";
import type { AccountLookup, GymPickerUnit, WithTenantTx } from "./ports";

export interface GymPickerDeps {
  readonly accounts: AccountLookup;
  readonly withUnit: WithTenantTx<GymPickerUnit>;
}

/** An identity session: it knows who the person is, and has not picked a gym yet. */
export interface GymPickerContext {
  /** The Google subject of the session, the one identity that spans every gym. */
  readonly subject: string;
}

/**
 * The gyms the signed in person belongs to, with their roles in each, so the app can show the
 * customer or the admin view. Only gyms where they hold a role come back, and each gym is read in
 * its own tenant transaction, so nothing but the gym's public handle and their own roles is read.
 */
export function makeListMyGyms(deps: GymPickerDeps) {
  return async (
    _input: undefined,
    ctx: GymPickerContext,
  ): Promise<Result<readonly GymSummary[], UnauthenticatedError>> => {
    if (ctx.subject.trim() === "") return unauthenticated();
    const accounts = await deps.accounts.gymsOf(ctx.subject);
    const gyms: GymSummary[] = [];
    // One gym at a time, so a person in many gyms never holds many pooled connections at once.
    for (const account of accounts) {
      const gym = await deps.withUnit(account.tenantId, (unit) => unit.gyms.find(account.userId));
      if (gym !== null) gyms.push(gym);
    }
    return ok(sortGyms(gyms));
  };
}
