import type { AttendanceQueryUnit, ScanUnit, WithTenantTx } from "../../app/ports";
import type { TenantTx } from "../db/tenant-tx";
import { makeTxExecutor } from "../db/tx-executor";
import { makeMemberQueryStore } from "../members/member-queries-sql";
import { makeTenantStore } from "../tenants/tenant-sql";
import { makeAttendanceQueryStore } from "./attendance-query-sql";
import { makeScanStore } from "./attendance-sql";

/** Runs the record scan use case in one tenant transaction. A scan writes no audit event. */
export function makeWithScanUnit(withTenantTx: WithTenantTx<TenantTx>): WithTenantTx<ScanUnit> {
  return (tenantId, fn) =>
    withTenantTx(tenantId, (tx) => {
      const executor = makeTxExecutor(tx);
      return fn({
        scans: makeScanStore(executor, tenantId),
        members: makeMemberQueryStore(executor, tenantId),
        tenants: makeTenantStore(executor, tenantId),
      });
    });
}

/** Runs the attendance queries in one tenant transaction. They only read. */
export function makeWithAttendanceQueryUnit(
  withTenantTx: WithTenantTx<TenantTx>,
): WithTenantTx<AttendanceQueryUnit> {
  return (tenantId, fn) =>
    withTenantTx(tenantId, (tx) => {
      const executor = makeTxExecutor(tx);
      return fn({
        attendance: makeAttendanceQueryStore(executor, tenantId),
        tenants: makeTenantStore(executor, tenantId),
      });
    });
}
