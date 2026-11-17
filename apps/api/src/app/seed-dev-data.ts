import { localDateIn, subtractDays } from "../domain/calendar";
import type { DomainError } from "../domain/errors";
import type { NewMemberInput } from "../domain/member";
import type { MembershipChangeInput } from "../domain/membership";
import type { OnboardGymInput } from "../domain/onboarding";
import type { Result } from "../domain/result";
import { SEED_REASONS, type SeedGym, type SeedMember } from "../domain/seed-data";
import type { InviteInput } from "../domain/staff";
import type { CreatedMember } from "./create-member";
import type { OnboardedGym } from "./onboarding";
import type { Clock, IdGenerator, SeedPaymentUnit, WithTenantTx } from "./ports";

/** Who the seed acts as inside one gym. */
interface Actor {
  readonly tenantId: string;
  readonly userId: string;
  readonly requestId: string;
  readonly roles: readonly ["owner"];
}

/** A real use case fits this shape, and so does a stub, so the seed is testable without a database. */
type Step<Input, Output> = (input: Input, actor: Actor) => Promise<Result<Output, DomainError>>;

export interface SeedDevDataDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly onboard: (
    input: OnboardGymInput,
    ctx: { readonly requestId: string },
  ) => Promise<Result<OnboardedGym, DomainError>>;
  readonly inviteUser: Step<InviteInput, unknown>;
  readonly createMember: Step<NewMemberInput, CreatedMember>;
  readonly pauseMember: Step<MembershipChangeInput, unknown>;
  readonly cancelMember: Step<MembershipChangeInput, unknown>;
  /** Finds a user of the gym by email. The seed acts as the owner the onboarding just made. */
  readonly findUserIdByEmail: (tenantId: string, email: string) => Promise<string | null>;
  readonly withPaymentUnit: WithTenantTx<SeedPaymentUnit>;
}

export interface SeededGym {
  readonly subdomain: string;
  readonly tenantId: string;
  /** False when the gym was already there. Nothing is written then, so a rerun is safe. */
  readonly created: boolean;
  readonly members: number;
}

export const SEED_PAYMENT_RECORDED = "payment.recorded";

/** A failed step is a bug in the fixtures or the database, so it stops the seed and says which step. */
function expectOk<T, E extends DomainError>(result: Result<T, E>, step: string): T {
  if (!result.ok) throw new Error(`Seed step failed, ${step}: ${result.error.message}`);
  return result.value;
}

/**
 * Seeds the local dataset: two gyms, each with an owner, a staff member and members in every
 * standing. Everything goes through the real use cases, so the data obeys the same rules as data
 * entered by hand. A gym that already exists is left alone, which makes the whole run repeatable.
 * If a run stops half way, drop the dev database and run it again, because the half made gym
 * counts as existing.
 */
export function makeSeedDevData(deps: SeedDevDataDeps) {
  async function ownerOf(tenantId: string, email: string): Promise<string> {
    const userId = await deps.findUserIdByEmail(tenantId, email);
    if (userId === null) throw new Error("A gym that was just created has no owner");
    return userId;
  }

  async function payInvoices(
    actor: Actor,
    memberId: string,
    created: CreatedMember,
    today: string,
  ) {
    for (const invoice of created.invoices) {
      await deps.withPaymentUnit(actor.tenantId, async (unit) => {
        const paymentId = await unit.payments.insertPaid({
          memberId,
          invoiceId: invoice.id,
          amount: invoice.total,
          paidOn: today,
          recordedBy: actor.userId,
          clientRequestId: deps.ids.next(),
        });
        await unit.audit.record({
          actorUserId: actor.userId,
          action: SEED_PAYMENT_RECORDED,
          entityType: "payment",
          entityId: paymentId,
          before: null,
          after: { memberId, invoiceId: invoice.id, amount: invoice.total, paidOn: today },
          requestId: actor.requestId,
        });
      });
    }
  }

  async function seedMember(actor: Actor, seed: SeedMember, today: string): Promise<void> {
    const created = expectOk(
      await deps.createMember(
        {
          fullName: seed.fullName,
          email: seed.email,
          phone: seed.phone,
          joinDate: subtractDays(today, seed.daysSinceJoin),
        },
        actor,
      ),
      `create member ${seed.email}`,
    );
    if (seed.scenario === "paid") {
      await payInvoices(actor, created.memberId, created, today);
    } else if (seed.scenario === "paused") {
      expectOk(
        await deps.pauseMember({ memberId: created.memberId, reason: SEED_REASONS.paused }, actor),
        `pause member ${seed.email}`,
      );
    } else if (seed.scenario === "cancelled") {
      expectOk(
        await deps.cancelMember(
          { memberId: created.memberId, reason: SEED_REASONS.cancelled },
          actor,
        ),
        `cancel member ${seed.email}`,
      );
    }
  }

  async function seedGym(fixture: SeedGym): Promise<SeededGym> {
    const requestId = deps.ids.next();
    const onboarded = expectOk(
      await deps.onboard(fixture.gym, { requestId }),
      `onboard ${fixture.gym.subdomain}`,
    );
    const { tenantId, subdomain } = onboarded;
    if (!onboarded.created) return { subdomain, tenantId, created: false, members: 0 };

    const actor: Actor = {
      tenantId,
      userId: await ownerOf(tenantId, fixture.gym.ownerEmail),
      requestId,
      roles: ["owner"],
    };
    expectOk(await deps.inviteUser(fixture.staff, actor), `invite ${fixture.staff.email}`);
    const today = localDateIn(deps.clock.now(), fixture.gym.timezone);
    for (const member of fixture.members) await seedMember(actor, member, today);
    return { subdomain, tenantId, created: true, members: fixture.members.length };
  }

  return async (gyms: readonly SeedGym[]): Promise<readonly SeededGym[]> => {
    const seeded: SeededGym[] = [];
    for (const gym of gyms) seeded.push(await seedGym(gym));
    return seeded;
  };
}
