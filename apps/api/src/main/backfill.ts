import { readFile } from "node:fs/promises";
import { type BackfillReport, makeBackfill } from "../app/backfill";
import type { BackfillConfig } from "../app/config";
import type { ValidationError } from "../domain/errors";
import type { Result } from "../domain/result";
import { parseBackfillFile } from "../infra/backfill/backfill-file";
import { makeWithBackfillUnit } from "../infra/backfill/backfill-unit";
import { dryRunOf } from "../infra/backfill/dry-run";
import { clockOnLocalDate, systemClock } from "../infra/clock";
import { makeDataSource } from "../infra/db/data-source";
import { makeWithTenantTx } from "../infra/db/tenant-tx";
import { stableId, uuidGenerator } from "../infra/ids";
import { randomCodes } from "../infra/members/member-codes";

/** Loads a gym's old members, as the app role in the url, and always closes the pool again. */
export type RunBackfill = (
  databaseUrl: string,
  options: BackfillConfig,
) => Promise<Result<BackfillReport, ValidationError>>;

/**
 * Composition root of the backfill job: the real file, database, clock and ids behind the use
 * case. A dry run uses the same code on a transaction that is rolled back at the end of each
 * member, so it reports what a real run would write and writes nothing.
 */
export const runBackfill: RunBackfill = async (databaseUrl, options) => {
  const inputs = parseBackfillFile(await readFile(options.file, "utf8"));
  if (!inputs.ok) return inputs;
  const source = makeDataSource(databaseUrl);
  await source.initialize();
  try {
    const withTenantTx = makeWithTenantTx(source);
    const audit = { clock: systemClock, ids: uuidGenerator };
    const backfill = makeBackfill({
      withUnit: makeWithBackfillUnit(options.dryRun ? dryRunOf(withTenantTx) : withTenantTx, audit),
      clock: systemClock,
      clockOn: clockOnLocalDate,
      codes: randomCodes,
      stableId,
    });
    return await backfill(
      inputs.value,
      { tenantId: options.tenantId, requestId: uuidGenerator.next() },
      { dryRun: options.dryRun },
    );
  } finally {
    await source.destroy();
  }
};
