import type { ValidationError } from "../domain/errors";
import { type DefaultPlanInput, type NewPlan, type Plan, parseDefaultPlan } from "../domain/plans";
import { ok, type Result } from "../domain/result";
import type { PlanUnit, WithTenantTx } from "./ports";

export interface PlanDeps {
  readonly withUnit: WithTenantTx<PlanUnit>;
}

/** The gym comes from the session (or from the onboarding job), never from client input. */
export interface PlanContext {
  readonly tenantId: string;
  readonly requestId: string;
}

export interface SeededPlan {
  readonly plan: Plan;
  /** False when the gym already had its default plan and nothing was written. */
  readonly created: boolean;
}

export const PLAN_CREATED = "plan.created";

/**
 * Every plan of the gym, archived ones too, so a member whose plan was archived still reads it.
 * Any signed in user of the gym may read plans, so there is no permission to check.
 */
export function makeListPlans(deps: PlanDeps) {
  return async (_input: undefined, ctx: PlanContext): Promise<Result<readonly Plan[], never>> =>
    ok(await deps.withUnit(ctx.tenantId, (unit) => unit.plans.list()));
}

/**
 * Inserts the default plan inside a transaction that is already open, with its audit event, or
 * reads the plan that is there. Seeding twice changes nothing, so the onboarding job can be rerun.
 */
export async function seedPlan(
  unit: PlanUnit,
  newPlan: NewPlan,
  requestId: string,
): Promise<SeededPlan> {
  const inserted = await unit.plans.insertIfAbsent(newPlan);
  if (inserted === null) {
    const existing = await unit.plans.findByKey(newPlan.key);
    if (existing === null) throw new Error("The default plan exists but cannot be read");
    return { plan: existing, created: false };
  }
  await unit.audit.record({
    actorUserId: null,
    action: PLAN_CREATED,
    entityType: "plan",
    entityId: inserted.id,
    before: null,
    after: {
      key: inserted.key,
      name: inserted.name,
      admissionFee: inserted.admissionFee,
      monthlyFee: inserted.monthlyFee,
    },
    requestId,
  });
  return { plan: inserted, created: true };
}

/**
 * Gives a new gym its one default plan, for the onboarding job. Running it again for the same gym
 * changes nothing, so onboarding can be repeated. The plan and its audit event commit together.
 */
export function makeSeedDefaultPlan(deps: PlanDeps) {
  return async (
    input: DefaultPlanInput,
    ctx: PlanContext,
  ): Promise<Result<SeededPlan, ValidationError>> => {
    const parsed = parseDefaultPlan(input);
    if (!parsed.ok) return parsed;
    const newPlan = parsed.value;
    return ok(await deps.withUnit(ctx.tenantId, (unit) => seedPlan(unit, newPlan, ctx.requestId)));
  };
}
