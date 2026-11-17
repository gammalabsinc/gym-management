import type { WithTenantTx } from "../../app/ports";

/** Carries what a dry run computed out of a transaction that is being rolled back. */
class DryRunRollback extends Error {
  readonly outcome: unknown;

  constructor(outcome: unknown) {
    super("Dry run, rolled back");
    this.name = "DryRunRollback";
    this.outcome = outcome;
  }
}

/**
 * Runs everything the real transaction would run, then rolls it back, and hands the result of the
 * work to the caller. So a dry run reports exactly what a real run would write, and writes
 * nothing. An error from the work is not a dry run result and still reaches the caller.
 */
export function dryRunOf<Tx>(withTx: WithTenantTx<Tx>): WithTenantTx<Tx> {
  return async <T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> => {
    try {
      return await withTx(tenantId, async (tx) => {
        throw new DryRunRollback(await fn(tx));
      });
    } catch (error) {
      if (error instanceof DryRunRollback) return error.outcome as T;
      throw error;
    }
  };
}
