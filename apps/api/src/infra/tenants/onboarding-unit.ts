import type { OnboardUnit, WithTenantTx } from "../../app/ports";
import { type AuditLogDeps, makeAuditLog } from "../db/audit-log";
import type { TenantTx } from "../db/tenant-tx";
import { makeTxExecutor } from "../db/tx-executor";
import { makePlanStore } from "../plans/plans-sql";
import { makeStaffDirectory } from "../staff/staff-sql";
import { makeGymProvisioner } from "./onboarding-sql";

/**
 * Runs the onboarding job in one transaction scoped to the new gym's id, with the gym row, the
 * owner, the plan and the audit log all on it, so they commit together or not at all.
 */
export function makeWithOnboardUnit(
  withTenantTx: WithTenantTx<TenantTx>,
  audit: AuditLogDeps,
): WithTenantTx<OnboardUnit> {
  return (tenantId, fn) =>
    withTenantTx(tenantId, (tx) => {
      const executor = makeTxExecutor(tx);
      return fn({
        gyms: makeGymProvisioner(executor),
        staff: makeStaffDirectory(executor, tenantId),
        plans: makePlanStore(executor, tenantId),
        audit: makeAuditLog(tx, audit),
      });
    });
}
