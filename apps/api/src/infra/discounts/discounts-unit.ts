import type { DiscountUnit, WithTenantTx } from "../../app/ports";
import { type AuditLogDeps, makeAuditLog } from "../db/audit-log";
import type { TenantTx } from "../db/tenant-tx";
import { makeTxExecutor } from "../db/tx-executor";
import { makeInvoiceStore } from "../invoices/invoices-sql";
import { makeTenantStore } from "../tenants/tenant-sql";
import { makeDiscountStore } from "./discounts-sql";

/** Runs a discount change in one tenant transaction. The change and its audit event commit together. */
export function makeWithDiscountUnit(
  withTenantTx: WithTenantTx<TenantTx>,
  audit: AuditLogDeps,
): WithTenantTx<DiscountUnit> {
  return (tenantId, fn) =>
    withTenantTx(tenantId, (tx) => {
      const executor = makeTxExecutor(tx);
      return fn({
        discounts: makeDiscountStore(executor, tenantId),
        invoices: makeInvoiceStore(executor, tenantId),
        tenants: makeTenantStore(executor, tenantId),
        audit: makeAuditLog(tx, audit),
      });
    });
}
