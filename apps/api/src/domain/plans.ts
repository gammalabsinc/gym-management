import { type ConflictError, conflict, type ValidationError, validationError } from "./errors";
import { err, ok, type Result } from "./result";

/** Every gym starts with one plan under this key. Its fees are edited on the settings screen. */
export const DEFAULT_PLAN_KEY = "default";
export const DEFAULT_PLAN_NAME = "Default";

/** The plans fee columns are 32 bit integers, in minor units. */
export const MAX_FEE = 2_147_483_647;
export const MAX_PLAN_NAME_LENGTH = 120;

export interface Plan {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly admissionFee: number;
  readonly monthlyFee: number;
  /** False once the plan is archived. */
  readonly isActive: boolean;
}

export interface NewPlan {
  readonly key: string;
  readonly name: string;
  readonly admissionFee: number;
  readonly monthlyFee: number;
}

export interface PlanFieldsInput {
  readonly name: string;
  readonly admissionFee: number;
  readonly monthlyFee: number;
}

export interface PlanFields {
  readonly name: string;
  readonly admissionFee: number;
  readonly monthlyFee: number;
}

export interface DefaultPlanInput {
  readonly admissionFee: number;
  readonly monthlyFee: number;
  readonly name?: string | undefined;
}

function feeIssue(field: string, value: number) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_FEE
    ? []
    : [{ path: [field], message: "Must be a whole number of minor units, zero or more" }];
}

/** Checks the name and the two fees of a plan. Every problem is reported. */
export function parsePlanFields(input: PlanFieldsInput): Result<PlanFields, ValidationError> {
  const name = input.name.trim();
  const issues = [
    ...(name === "" ? [{ path: ["name"], message: "Required" }] : []),
    ...(name.length > MAX_PLAN_NAME_LENGTH
      ? [{ path: ["name"], message: `At most ${MAX_PLAN_NAME_LENGTH} characters` }]
      : []),
    ...feeIssue("admissionFee", input.admissionFee),
    ...feeIssue("monthlyFee", input.monthlyFee),
  ];
  if (issues.length > 0) return validationError("Invalid plan", issues);
  return ok({ name, admissionFee: input.admissionFee, monthlyFee: input.monthlyFee });
}

/** Checks the fees and name of the plan a new gym starts with. A blank name becomes "Default". */
export function parseDefaultPlan(input: DefaultPlanInput): Result<NewPlan, ValidationError> {
  const fields = parsePlanFields({ ...input, name: input.name?.trim() || DEFAULT_PLAN_NAME });
  return fields.ok ? ok({ key: DEFAULT_PLAN_KEY, ...fields.value }) : fields;
}

/**
 * An archived plan stays readable on the members who already have it, but nobody new is put on it.
 * Whatever assigns a plan to a member asks this first.
 */
export function ensureAssignable(plan: Plan): Result<Plan, ConflictError> {
  return plan.isActive ? ok(plan) : err(conflict("This plan is archived").error);
}
