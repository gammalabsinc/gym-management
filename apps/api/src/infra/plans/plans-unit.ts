import type { PlanUnit, WithTenantTx } from "../../app/ports";
import { type AuditLogDeps, makeAuditLog } from "../db/audit-log";
import type { TenantTx } from "../db/tenant-tx";
import { makeTxExecutor } from "../db/tx-executor";
import { makePlanStore } from "./plans-sql";

/** Runs a plan use case in one tenant transaction, with the plan store and audit log on it. */
export function makeWithPlanUnit(
  withTenantTx: WithTenantTx<TenantTx>,
  audit: AuditLogDeps,
): WithTenantTx<PlanUnit> {
  return (tenantId, fn) =>
    withTenantTx(tenantId, (tx) =>
      fn({ plans: makePlanStore(makeTxExecutor(tx), tenantId), audit: makeAuditLog(tx, audit) }),
    );
}
