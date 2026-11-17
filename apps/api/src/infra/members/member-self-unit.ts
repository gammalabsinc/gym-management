import type { MemberSelfServiceUnit, WithTenantTx } from "../../app/ports";
import { makeAttendanceQueryStore } from "../attendance/attendance-query-sql";
import type { TenantTx } from "../db/tenant-tx";
import { makeTxExecutor } from "../db/tx-executor";
import { makeTenantStore } from "../tenants/tenant-sql";
import { makeMemberQueryStore } from "./member-queries-sql";
import { makeMemberSelfStore } from "./member-self-sql";

/** Runs the member's own reads in one tenant transaction. Nothing here writes. */
export function makeWithMemberSelfUnit(
  withTenantTx: WithTenantTx<TenantTx>,
): WithTenantTx<MemberSelfServiceUnit> {
  return (tenantId, fn) =>
    withTenantTx(tenantId, (tx) => {
      const executor = makeTxExecutor(tx);
      return fn({
        self: makeMemberSelfStore(executor, tenantId),
        members: makeMemberQueryStore(executor, tenantId),
        attendance: makeAttendanceQueryStore(executor, tenantId),
        tenants: makeTenantStore(executor, tenantId),
      });
    });
}
