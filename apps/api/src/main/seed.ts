import { makeCancelMember, makePauseMember } from "../app/change-membership";
import { makeCreateMember } from "../app/create-member";
import { makeOnboardGym } from "../app/onboarding";
import { makeInviteUser } from "../app/role-management";
import { makeSeedDevData, type SeededGym } from "../app/seed-dev-data";
import { DEV_GYMS } from "../domain/seed-data";
import { systemClock } from "../infra/clock";
import { makeDataSource } from "../infra/db/data-source";
import { makeWithTenantTx } from "../infra/db/tenant-tx";
import { uuidGenerator } from "../infra/ids";
import { randomCodes } from "../infra/members/member-codes";
import { makeWithMemberUnit } from "../infra/members/members-unit";
import { makeWithMembershipUnit } from "../infra/memberships/memberships-unit";
import { makeWithSeedPaymentUnit } from "../infra/payments/seed-payments-unit";
import { makeWithStaffUnit } from "../infra/staff/staff-unit";
import { makeWithOnboardUnit } from "../infra/tenants/onboarding-unit";

/** Seeds the dev dataset, as the app role in the url, and always closes the pool again. */
export type SeedDevData = (databaseUrl: string) => Promise<readonly SeededGym[]>;

/** Composition root of the seed job: the real database, clock, ids and codes behind the use cases. */
export const seedDevData: SeedDevData = async (databaseUrl) => {
  const source = makeDataSource(databaseUrl);
  await source.initialize();
  try {
    const withTenantTx = makeWithTenantTx(source);
    const audit = { clock: systemClock, ids: uuidGenerator };
    const withStaffUnit = makeWithStaffUnit(withTenantTx, audit);
    const membership = {
      withUnit: makeWithMembershipUnit(withTenantTx, audit),
      clock: systemClock,
    };
    const seed = makeSeedDevData({
      clock: systemClock,
      ids: uuidGenerator,
      onboard: makeOnboardGym({
        ids: uuidGenerator,
        withUnit: makeWithOnboardUnit(withTenantTx, audit),
      }),
      inviteUser: makeInviteUser({ withUnit: withStaffUnit, clock: systemClock }),
      createMember: makeCreateMember({
        withUnit: makeWithMemberUnit(withTenantTx, audit),
        clock: systemClock,
        codes: randomCodes,
      }),
      pauseMember: makePauseMember(membership),
      cancelMember: makeCancelMember(membership),
      findUserIdByEmail: async (tenantId, email) => {
        const user = await withStaffUnit(tenantId, (unit) => unit.staff.findByEmail(email));
        return user === null ? null : user.userId;
      },
      withPaymentUnit: makeWithSeedPaymentUnit(withTenantTx, audit),
    });
    return await seed(DEV_GYMS);
  } finally {
    await source.destroy();
  }
};
