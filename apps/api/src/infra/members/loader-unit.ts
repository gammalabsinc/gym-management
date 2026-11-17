import type { LoaderUnit, WithTenantTx } from "../../app/ports";
import type { TenantTx } from "../db/tenant-tx";
import { makeTxExecutor } from "../db/tx-executor";
import { makePlanStore } from "../plans/plans-sql";
import { makeTenantStore } from "../tenants/tenant-sql";
import { makeMemberQueryStore } from "./member-queries-sql";

/** Runs one loader batch in one tenant transaction. Nothing here writes, so there is no audit log. */
export function makeWithLoaderUnit(withTenantTx: WithTenantTx<TenantTx>): WithTenantTx<LoaderUnit> {
  return (tenantId, fn) =>
    withTenantTx(tenantId, (tx) => {
      const executor = makeTxExecutor(tx);
      return fn({
        members: makeMemberQueryStore(executor, tenantId),
        plans: makePlanStore(executor, tenantId),
        tenants: makeTenantStore(executor, tenantId),
      });
    });
}
