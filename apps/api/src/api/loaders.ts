import DataLoader from "dataloader";
import { memberQueryContext } from "../app/member-queries";
import type { Clock, LoaderUnit, WithTenantTx } from "../app/ports";
import type { MemberView } from "../domain/member-view";
import type { Plan } from "../domain/plans";
import type { Standing } from "../domain/standing";
import { parseUuid } from "../domain/uuid";

/** Most ids sent to the database in one statement. It matches the largest page a list can return. */
export const MAX_BATCH_SIZE = 100;

export interface LoaderDeps {
  readonly withUnit: WithTenantTx<LoaderUnit>;
  readonly clock: Clock;
}

/** The lookups one request shares. Every answer is cached for the life of the request. */
export interface RequestLoaders {
  /** A member of the session gym with plan, standing and counts. Null for an unknown id. */
  readonly member: DataLoader<string, MemberView | null>;
  /** A plan of the session gym, archived ones included. Null for an unknown id. */
  readonly plan: DataLoader<string, Plan | null>;
  /** A member's standing. It rides on the member loader, so it never adds a statement. */
  standing(memberId: string): Promise<Standing | null>;
}

/** Lines results up with the keys that were asked for, with null for a key nothing was found for. */
function byKey<T>(
  keys: readonly string[],
  found: readonly T[],
  keyOf: (item: T) => string,
): (T | null)[] {
  const items = new Map(found.map((item) => [keyOf(item), item]));
  return keys.map((key) => items.get(key) ?? null);
}

/** An id that is not a uuid cannot belong to anyone, so it is answered without asking the database. */
function validIds(keys: readonly string[]): string[] {
  return keys.filter((key) => parseUuid(key, "id").ok);
}

/**
 * Builds the loaders of one request. The gym comes from the session and is fixed here, so a
 * loader can only ever read that gym. All ids asked for in the same tick go to the database in
 * one statement, so a page of rows costs a fixed number of queries whatever its size. The clock is
 * read once, so every member of the request derives its standing from the same moment.
 */
export function makeRequestLoaders(deps: LoaderDeps, tenantId: string): RequestLoaders {
  const now = deps.clock.now();
  const options = { maxBatchSize: MAX_BATCH_SIZE };

  const member = new DataLoader<string, MemberView | null>(async (keys) => {
    const ids = validIds(keys);
    const found = await deps.withUnit(tenantId, async (unit) => {
      const tenant = await unit.tenants.find();
      if (tenant === null) throw new Error("The gym of this transaction cannot be read");
      return unit.members.findMany(ids, memberQueryContext(tenant, now));
    });
    return byKey(keys, found, (view) => view.id);
  }, options);

  const plan = new DataLoader<string, Plan | null>(async (keys) => {
    const found = await deps.withUnit(tenantId, (unit) => unit.plans.findMany(validIds(keys)));
    return byKey(keys, found, (item) => item.id);
  }, options);

  return {
    member,
    plan,
    standing: async (memberId) => (await member.load(memberId))?.standing ?? null,
  };
}
