import type { VoidUnit, WithTenantTx } from "../../app/ports";
import { type AuditLogDeps, makeAuditLog } from "../db/audit-log";
import type { TenantTx } from "../db/tenant-tx";
import { makeTxExecutor } from "../db/tx-executor";
import { makeInvoiceStore } from "../invoices/invoices-sql";
import { makePaymentStore } from "./payments-sql";
import { makeVoidStore } from "./voids-sql";

/** Runs a void in one tenant transaction. The void, the credit it frees and the audit event commit together. */
export function makeWithVoidUnit(
  withTenantTx: WithTenantTx<TenantTx>,
  audit: AuditLogDeps,
): WithTenantTx<VoidUnit> {
  return (tenantId, fn) =>
    withTenantTx(tenantId, (tx) => {
      const executor = makeTxExecutor(tx);
      return fn({
        voids: makeVoidStore(executor, tenantId),
        payments: makePaymentStore(executor, tenantId),
        invoices: makeInvoiceStore(executor, tenantId),
        audit: makeAuditLog(tx, audit),
      });
    });
}
