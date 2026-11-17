import type { GymPickerUnit, WithTenantTx } from "../../app/ports";
import type { TenantTx } from "../db/tenant-tx";
import { makeTxExecutor } from "../db/tx-executor";
import { makeGymPickerStore } from "./gym-picker-sql";

/** Runs a gym picker read in one tenant transaction. */
export function makeWithGymPickerUnit(
  withTenantTx: WithTenantTx<TenantTx>,
): WithTenantTx<GymPickerUnit> {
  return (tenantId, fn) =>
    withTenantTx(tenantId, (tx) => fn({ gyms: makeGymPickerStore(makeTxExecutor(tx), tenantId) }));
}
