import type { ProfileUnit, WithTenantTx } from "../../app/ports";
import { type AuditLogDeps, makeAuditLog } from "../db/audit-log";
import type { TenantTx } from "../db/tenant-tx";
import { makeTxExecutor } from "../db/tx-executor";
import { makeProfileStore } from "./profiles-sql";

/** Runs a profile edit in one tenant transaction, with its audit event on the same one. */
export function makeWithProfileUnit(
  withTenantTx: WithTenantTx<TenantTx>,
  audit: AuditLogDeps,
): WithTenantTx<ProfileUnit> {
  return (tenantId, fn) =>
    withTenantTx(tenantId, (tx) =>
      fn({
        profiles: makeProfileStore(makeTxExecutor(tx), tenantId),
        audit: makeAuditLog(tx, audit),
      }),
    );
}
