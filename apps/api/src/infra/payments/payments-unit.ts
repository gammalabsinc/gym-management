import type { PaymentUnit, WithTenantTx } from "../../app/ports";
import { type AuditLogDeps, makeAuditLog } from "../db/audit-log";
import type { TenantTx } from "../db/tenant-tx";
import { makeTxExecutor } from "../db/tx-executor";
import { makeInvoiceStore } from "../invoices/invoices-sql";
import { makeTenantStore } from "../tenants/tenant-sql";
import { makePaymentStore } from "./payments-sql";

/**
 * Runs the record payment use case in one tenant transaction. The payment, its allocations, the
 * invoices it builds and the audit events are all written on it, so they commit together or not
 * at all.
 */
export function makeWithPaymentUnit(
  withTenantTx: WithTenantTx<TenantTx>,
  audit: AuditLogDeps,
): WithTenantTx<PaymentUnit> {
  return (tenantId, fn) =>
    withTenantTx(tenantId, (tx) => {
      const executor = makeTxExecutor(tx);
      return fn({
        payments: makePaymentStore(executor, tenantId),
        invoices: makeInvoiceStore(executor, tenantId),
        tenants: makeTenantStore(executor, tenantId),
        audit: makeAuditLog(tx, audit),
      });
    });
}
