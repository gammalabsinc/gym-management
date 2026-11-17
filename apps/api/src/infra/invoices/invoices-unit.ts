import type { InvoiceUnit, WithTenantTx } from "../../app/ports";
import { type AuditLogDeps, makeAuditLog } from "../db/audit-log";
import type { TenantTx } from "../db/tenant-tx";
import { makeTxExecutor } from "../db/tx-executor";
import { makeTenantStore } from "../tenants/tenant-sql";
import { makeInvoiceStore } from "./invoices-sql";

/** Runs an invoice use case in one tenant transaction, with the audit log and the gym row on it. */
export function makeWithInvoiceUnit(
  withTenantTx: WithTenantTx<TenantTx>,
  audit: AuditLogDeps,
): WithTenantTx<InvoiceUnit> {
  return (tenantId, fn) =>
    withTenantTx(tenantId, (tx) => {
      const executor = makeTxExecutor(tx);
      return fn({
        invoices: makeInvoiceStore(executor, tenantId),
        tenants: makeTenantStore(executor, tenantId),
        audit: makeAuditLog(tx, audit),
      });
    });
}
