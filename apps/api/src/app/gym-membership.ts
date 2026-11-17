import type { GymSummary } from "../domain/gym-picker";
import type { AccountLookup, GymPickerUnit, WithTenantTx } from "./ports";

export interface MembershipDeps {
  readonly accounts: AccountLookup;
  readonly withUnit: WithTenantTx<GymPickerUnit>;
}

/** What a person holds in one gym: their user row there and the gym as they may see it. */
export interface Membership {
  readonly userId: string;
  readonly gym: GymSummary;
}

export type FindMembership = (subject: string, gymId: string) => Promise<Membership | null>;

/**
 * Finds the person's place in one gym. Null when they have no active user row there, hold no
 * role there, or the gym is switched off. The roles are read inside the gym's own tenant
 * transaction, so no other gym's rows are ever in reach.
 */
export function makeFindMembership(deps: MembershipDeps): FindMembership {
  return async (subject, gymId) => {
    const accounts = await deps.accounts.gymsOf(subject);
    const account = accounts.find((candidate) => candidate.tenantId === gymId);
    if (account === undefined) return null;
    const gym = await deps.withUnit(gymId, (unit) => unit.gyms.find(account.userId));
    return gym === null ? null : { userId: account.userId, gym };
  };
}
