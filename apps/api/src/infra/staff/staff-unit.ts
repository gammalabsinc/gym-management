import type { StaffUnit, WithTenantTx } from "../../app/ports";
import { type AuditLogDeps, makeAuditLog } from "../db/audit-log";
import type { TenantTx } from "../db/tenant-tx";
import { makeTxExecutor } from "../db/tx-executor";
import { makeSessionStore } from "../sessions/sessions-sql";
import { makeStaffDirectory } from "./staff-sql";

/**
 * Runs a role management use case in one tenant transaction, with the staff directory, the audit
 * log and the session store all on that transaction. The change, its audit event and the end of
 * the person's sessions commit together or not at all.
 */
export function makeWithStaffUnit(
  withTenantTx: WithTenantTx<TenantTx>,
  audit: AuditLogDeps,
): WithTenantTx<StaffUnit> {
  return (tenantId, fn) =>
    withTenantTx(tenantId, (tx) => {
      const executor = makeTxExecutor(tx);
      return fn({
        staff: makeStaffDirectory(executor, tenantId),
        audit: makeAuditLog(tx, audit),
        sessions: makeSessionStore(executor),
      });
    });
}
