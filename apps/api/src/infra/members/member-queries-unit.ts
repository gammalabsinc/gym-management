import type { MemberQueryUnit, WithTenantTx } from "../../app/ports";
import type { TenantTx } from "../db/tenant-tx";
import { makeTxExecutor } from "../db/tx-executor";
import { makeTenantStore } from "../tenants/tenant-sql";
import { makeMemberQueryStore } from "./member-queries-sql";

/** Runs the member queries in one tenant transaction. Nothing here writes, so there is no audit log. */
export function makeWithMemberQueryUnit(
  withTenantTx: WithTenantTx<TenantTx>,
): WithTenantTx<MemberQueryUnit> {
  return (tenantId, fn) =>
    withTenantTx(tenantId, (tx) => {
      const executor = makeTxExecutor(tx);
      return fn({
        members: makeMemberQueryStore(executor, tenantId),
        tenants: makeTenantStore(executor, tenantId),
      });
    });
}
