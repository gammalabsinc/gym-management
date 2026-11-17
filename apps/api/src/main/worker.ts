import pg from "pg";
import { makeInvoiceTopUp, type TopUpSummary } from "../app/invoice-top-up";
import type { Logger } from "../app/ports";
import { systemClock } from "../infra/clock";
import { makeDataSource } from "../infra/db/data-source";
import { makeWithTenantTx } from "../infra/db/tenant-tx";
import { uuidGenerator } from "../infra/ids";
import { makeTenantJobLock } from "../infra/jobs/tenant-lock";
import { makeTenantRegistry } from "../infra/jobs/tenant-registry-sql";
import { makeWithTopUpUnit } from "../infra/jobs/top-up-unit";

/** Runs the daily invoice job once, as the app role in the url, and always closes its pools again. */
export type RunWorker = (databaseUrl: string, logger: Logger) => Promise<TopUpSummary>;

/** Composition root of the worker: the real database, lock, clock and ids behind the job. */
export const runInvoiceTopUp: RunWorker = async (databaseUrl, logger) => {
  const source = makeDataSource(databaseUrl);
  await source.initialize();
  // Gyms are worked one after the other, so one connection is all the lock ever needs.
  const lockPool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const topUp = makeInvoiceTopUp({
      tenants: makeTenantRegistry({ query: (sql, params) => source.query(sql, params) }),
      lock: makeTenantJobLock(lockPool),
      withUnit: makeWithTopUpUnit(makeWithTenantTx(source), {
        clock: systemClock,
        ids: uuidGenerator,
      }),
      clock: systemClock,
      logger,
    });
    return await topUp({ requestId: uuidGenerator.next() });
  } finally {
    await lockPool.end();
    await source.destroy();
  }
};
