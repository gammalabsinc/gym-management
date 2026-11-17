import type { OnboardedGym } from "../app/onboarding";
import { makeOnboardGym } from "../app/onboarding";
import type { ValidationError } from "../domain/errors";
import type { OnboardGymInput } from "../domain/onboarding";
import type { Result } from "../domain/result";
import { systemClock } from "../infra/clock";
import { makeDataSource } from "../infra/db/data-source";
import { makeWithTenantTx } from "../infra/db/tenant-tx";
import { uuidGenerator } from "../infra/ids";
import { makeWithOnboardUnit } from "../infra/tenants/onboarding-unit";

/** Adds a gym, as the app role in the url, and always closes the pool again. */
export type OnboardGym = (
  databaseUrl: string,
  input: OnboardGymInput,
) => Promise<Result<OnboardedGym, ValidationError>>;

/** Composition root of the onboarding job: the real database, clock and ids behind the use case. */
export const onboardGym: OnboardGym = async (databaseUrl, input) => {
  const source = makeDataSource(databaseUrl);
  await source.initialize();
  try {
    const onboard = makeOnboardGym({
      ids: uuidGenerator,
      withUnit: makeWithOnboardUnit(makeWithTenantTx(source), {
        clock: systemClock,
        ids: uuidGenerator,
      }),
    });
    return await onboard(input, { requestId: uuidGenerator.next() });
  } finally {
    await source.destroy();
  }
};
