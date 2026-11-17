import type { SeedPaymentUnit, WithTenantTx } from "../../app/ports";
import { type AuditLogDeps, makeAuditLog } from "../db/audit-log";
import type { TenantTx } from "../db/tenant-tx";
import { makeTxExecutor } from "../db/tx-executor";
import { makeSeedPaymentStore } from "./seed-payments-sql";

/** Runs a seed payment in one tenant transaction, with its audit event on the same one. */
export function makeWithSeedPaymentUnit(
  withTenantTx: WithTenantTx<TenantTx>,
  audit: AuditLogDeps,
): WithTenantTx<SeedPaymentUnit> {
  return (tenantId, fn) =>
    withTenantTx(tenantId, (tx) =>
      fn({
        payments: makeSeedPaymentStore(makeTxExecutor(tx), tenantId),
        audit: makeAuditLog(tx, audit),
      }),
    );
}
