import type { WhoAmIUnit, WithTenantTx } from "../../app/ports";
import type { TenantTx } from "../db/tenant-tx";
import { makeTxExecutor } from "../db/tx-executor";
import { makeWhoAmIStore } from "./who-am-i-sql";

/** Runs the read of "me" in one tenant transaction. */
export function makeWithWhoAmIUnit(withTenantTx: WithTenantTx<TenantTx>): WithTenantTx<WhoAmIUnit> {
  return (tenantId, fn) =>
    withTenantTx(tenantId, (tx) => fn({ me: makeWhoAmIStore(makeTxExecutor(tx), tenantId) }));
}
