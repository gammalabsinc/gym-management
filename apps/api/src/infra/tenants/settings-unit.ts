import type { SettingsUnit, WithTenantTx } from "../../app/ports";
import { type AuditLogDeps, makeAuditLog } from "../db/audit-log";
import type { TenantTx } from "../db/tenant-tx";
import { makeTxExecutor } from "../db/tx-executor";
import { makePlanStore } from "../plans/plans-sql";
import { makeTenantStore } from "./tenant-sql";

/** Runs a profile or settings use case in one tenant transaction, with the audit log on it too. */
export function makeWithSettingsUnit(
  withTenantTx: WithTenantTx<TenantTx>,
  audit: AuditLogDeps,
): WithTenantTx<SettingsUnit> {
  return (tenantId, fn) =>
    withTenantTx(tenantId, (tx) => {
      const executor = makeTxExecutor(tx);
      return fn({
        tenants: makeTenantStore(executor, tenantId),
        plans: makePlanStore(executor, tenantId),
        audit: makeAuditLog(tx, audit),
      });
    });
}
