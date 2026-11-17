import { type FieldIssue, type ValidationError, validationError } from "./errors";
import { type NewPlan, parseDefaultPlan } from "./plans";
import { ok, type Result } from "./result";
import { type Invite, parseInvite } from "./staff";
import { DEFAULT_SETTINGS, type TenantSettings } from "./tenant";

export const MAX_GYM_NAME_LENGTH = 120;

/** A DNS label: lower case letters, digits and inner hyphens, at most 63 characters. */
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** IANA zone names are letters, digits, slashes, underscores, plus and minus. No offsets. */
const ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;
const CURRENCY = /^[A-Z]{3}$/;

/** What the operator types to add a gym. Fees are whole minor units and may be left at zero. */
export interface OnboardGymInput {
  readonly name: string;
  readonly subdomain: string;
  readonly timezone: string;
  readonly currency: string;
  readonly ownerEmail: string;
  readonly ownerName?: string | undefined;
  readonly admissionFee: number;
  readonly monthlyFee: number;
}

/** A gym ready to store: every field checked and in the form it is kept in. */
export interface NewGym {
  readonly name: string;
  readonly subdomain: string;
  readonly timezone: string;
  readonly currency: string;
  readonly settings: TenantSettings;
  readonly owner: Invite;
  readonly plan: NewPlan;
}

function isTimeZone(zone: string): boolean {
  if (!ZONE_NAME.test(zone)) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

function issue(field: string, message: string): FieldIssue {
  return { path: [field], message };
}

function gymIssues(input: OnboardGymInput): FieldIssue[] {
  const name = input.name.trim();
  return [
    ...(name === "" || name.length > MAX_GYM_NAME_LENGTH
      ? [issue("name", `Required, at most ${MAX_GYM_NAME_LENGTH} characters`)]
      : []),
    ...(SUBDOMAIN.test(input.subdomain.trim().toLowerCase())
      ? []
      : [issue("subdomain", "Use lower case letters, digits and hyphens, at most 63 characters")]),
    ...(isTimeZone(input.timezone.trim())
      ? []
      : [issue("timezone", "Use an IANA zone name such as America/Toronto")]),
    ...(CURRENCY.test(input.currency.trim().toUpperCase())
      ? []
      : [issue("currency", "Use a three letter ISO 4217 code such as CAD")]),
  ];
}

/**
 * Checks everything an operator types to add a gym and puts it in the form it is stored in: a
 * trimmed name, a lower case subdomain, an upper case currency, a lower case owner email, the
 * default settings and the default plan. Every problem is reported at once.
 */
export function parseNewGym(input: OnboardGymInput): Result<NewGym, ValidationError> {
  const owner = parseInvite({ email: input.ownerEmail, name: input.ownerName, role: "owner" });
  const plan = parseDefaultPlan({ admissionFee: input.admissionFee, monthlyFee: input.monthlyFee });
  const issues = [
    ...gymIssues(input),
    ...(owner.ok ? [] : owner.error.issues),
    ...(plan.ok ? [] : plan.error.issues),
  ];
  if (!owner.ok || !plan.ok || issues.length > 0) {
    return validationError("Invalid gym", issues);
  }
  return ok({
    name: input.name.trim(),
    subdomain: input.subdomain.trim().toLowerCase(),
    timezone: input.timezone.trim(),
    currency: input.currency.trim().toUpperCase(),
    settings: DEFAULT_SETTINGS,
    owner: owner.value,
    plan: plan.value,
  });
}
