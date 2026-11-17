import type { MemberUnit, WithTenantTx } from "../../app/ports";
import { type AuditLogDeps, makeAuditLog } from "../db/audit-log";
import type { TenantTx } from "../db/tenant-tx";
import { makeTxExecutor } from "../db/tx-executor";
import { makeReferralStore } from "../discounts/referrals-sql";
import { makeInvoiceStore } from "../invoices/invoices-sql";
import { makePlanStore } from "../plans/plans-sql";
import { makeStaffDirectory } from "../staff/staff-sql";
import { makeTenantStore } from "../tenants/tenant-sql";
import { makeMemberStore } from "./members-sql";

/**
 * Runs the create member use case in one tenant transaction. The person, the member, the period,
 * the referral discounts, the invoices and the audit events are all written on it, so they commit together or not at all.
 */
export function makeWithMemberUnit(
  withTenantTx: WithTenantTx<TenantTx>,
  audit: AuditLogDeps,
): WithTenantTx<MemberUnit> {
  return (tenantId, fn) =>
    withTenantTx(tenantId, (tx) => {
      const executor = makeTxExecutor(tx);
      return fn({
        members: makeMemberStore(executor, tenantId),
        staff: makeStaffDirectory(executor, tenantId),
        plans: makePlanStore(executor, tenantId),
        referrals: makeReferralStore(executor, tenantId),
        invoices: makeInvoiceStore(executor, tenantId),
        tenants: makeTenantStore(executor, tenantId),
        audit: makeAuditLog(tx, audit),
      });
    });
}
