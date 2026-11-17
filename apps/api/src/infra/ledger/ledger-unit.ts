import type { LedgerUnit, WithTenantTx } from "../../app/ports";
import type { TenantTx } from "../db/tenant-tx";
import { makeTxExecutor } from "../db/tx-executor";
import { makeMemberStore } from "../members/members-sql";
import { makeTenantStore } from "../tenants/tenant-sql";
import { makeLedgerStore } from "./ledger-sql";

/** Runs the ledger queries in one tenant transaction. They only read. */
export function makeWithLedgerUnit(withTenantTx: WithTenantTx<TenantTx>): WithTenantTx<LedgerUnit> {
  return (tenantId, fn) =>
    withTenantTx(tenantId, (tx) => {
      const executor = makeTxExecutor(tx);
      return fn({
        ledger: makeLedgerStore(executor, tenantId),
        members: makeMemberStore(executor, tenantId),
        tenants: makeTenantStore(executor, tenantId),
      });
    });
}
