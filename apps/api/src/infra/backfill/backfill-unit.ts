import type { BackfillUnit, WithTenantTx } from "../../app/ports";
import { type AuditLogDeps, makeAuditLog } from "../db/audit-log";
import type { TenantTx } from "../db/tenant-tx";
import { makeTxExecutor } from "../db/tx-executor";
import { makeInvoiceStore } from "../invoices/invoices-sql";
import { makeMemberStore } from "../members/members-sql";
import { makePeriodStore } from "../memberships/periods-sql";
import { makePaymentStore } from "../payments/payments-sql";
import { makePlanStore } from "../plans/plans-sql";
import { makeStaffDirectory } from "../staff/staff-sql";
import { makeTenantStore } from "../tenants/tenant-sql";
import { makeBackfillStore } from "./backfill-sql";

/**
 * Runs the loading of one member in one tenant transaction. The person, the member, the periods,
 * the discounts, the invoices, the payments and the audit events commit together or not at all.
 */
export function makeWithBackfillUnit(
  withTenantTx: WithTenantTx<TenantTx>,
  audit: AuditLogDeps,
): WithTenantTx<BackfillUnit> {
  return (tenantId, fn) =>
    withTenantTx(tenantId, (tx) => {
      const executor = makeTxExecutor(tx);
      return fn({
        members: makeMemberStore(executor, tenantId),
        staff: makeStaffDirectory(executor, tenantId),
        plans: makePlanStore(executor, tenantId),
        periods: makePeriodStore(executor, tenantId),
        invoices: makeInvoiceStore(executor, tenantId),
        payments: makePaymentStore(executor, tenantId),
        discounts: makeBackfillStore(executor, tenantId),
        tenants: makeTenantStore(executor, tenantId),
        audit: makeAuditLog(tx, audit),
      });
    });
}
