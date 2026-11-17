import type { TopUpUnit, WithTenantTx } from "../../app/ports";
import { type AuditLogDeps, makeAuditLog } from "../db/audit-log";
import type { TenantTx } from "../db/tenant-tx";
import { makeTxExecutor } from "../db/tx-executor";
import { makeInvoiceStore } from "../invoices/invoices-sql";
import { makeTenantStore } from "../tenants/tenant-sql";
import { makeMemberRoster } from "./member-roster-sql";

/** Runs one step of the daily invoice job in one tenant transaction, audit log included. */
export function makeWithTopUpUnit(
  withTenantTx: WithTenantTx<TenantTx>,
  audit: AuditLogDeps,
): WithTenantTx<TopUpUnit> {
  return (tenantId, fn) =>
    withTenantTx(tenantId, (tx) => {
      const executor = makeTxExecutor(tx);
      return fn({
        invoices: makeInvoiceStore(executor, tenantId),
        tenants: makeTenantStore(executor, tenantId),
        audit: makeAuditLog(tx, audit),
        roster: makeMemberRoster(executor, tenantId),
      });
    });
}
