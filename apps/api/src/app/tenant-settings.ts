import {
  type ConflictError,
  type ForbiddenError,
  forbidden,
  type NotFoundError,
  notFound,
  type ValidationError,
} from "../domain/errors";
import { type Plan, parsePlanFields } from "../domain/plans";
import { ok, type Result } from "../domain/result";
import { hasStaffAccess } from "../domain/staff";
import {
  applySettings,
  type MemberTenantView,
  parseSettingsPatch,
  type SettingsPatchInput,
  settingsToJson,
  type Tenant,
  toMemberView,
} from "../domain/tenant";
import { parseUuid } from "../domain/uuid";
import type { SettingsUnit, WithTenantTx } from "./ports";
import { type PermissionContext, requirePermission } from "./require-permission";

export const SETTINGS_UPDATED = "settings.updated";
export const PLAN_UPDATED = "plan.updated";

export interface SettingsDeps {
  readonly withUnit: WithTenantTx<SettingsUnit>;
}

/** The gym, the caller and the request all come from the session, never from client input. */
export interface SettingsContext extends PermissionContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly requestId: string;
}

/** Staff and owners read the whole profile. A member reads the name, the colour and the contacts. */
export type TenantView =
  | { readonly kind: "full"; readonly tenant: Tenant }
  | { readonly kind: "member"; readonly tenant: MemberTenantView };

export interface PlanUpdateInput {
  readonly planId: string;
  readonly name: string;
  readonly admissionFee: number;
  readonly monthlyFee: number;
}

type SettingsError = ValidationError | NotFoundError | ConflictError;

const TENANT_NOT_FOUND = "Gym not found";

/** The gym's profile, in the shape the caller is allowed to see. */
export function makeGetTenant(deps: SettingsDeps) {
  return async (
    _input: undefined,
    ctx: SettingsContext,
  ): Promise<Result<TenantView, NotFoundError | ForbiddenError>> => {
    if (ctx.roles.length === 0) return forbidden();
    const tenant = await deps.withUnit(ctx.tenantId, (unit) => unit.tenants.find());
    if (tenant === null) return notFound(TENANT_NOT_FOUND);
    return ok(
      hasStaffAccess(ctx.roles)
        ? { kind: "full", tenant }
        : { kind: "member", tenant: toMemberView(tenant) },
    );
  };
}

/**
 * Changes the settings the owner sent and leaves the rest. The audit event holds only the values
 * that changed, as they were and as they are now. Sending the values a gym already has writes
 * nothing. Existing invoices and discounts are never touched: settings are only read when new ones
 * are made.
 */
export function makeUpdateSettings(deps: SettingsDeps) {
  return requirePermission<SettingsPatchInput, SettingsContext, Tenant, SettingsError>(
    "settings.manage",
    async (input, ctx) => {
      const patch = parseSettingsPatch(input);
      if (!patch.ok) return patch;
      return deps.withUnit(ctx.tenantId, async (unit): Promise<Result<Tenant, SettingsError>> => {
        const tenant = await unit.tenants.findForUpdate();
        if (tenant === null) return notFound(TENANT_NOT_FOUND);
        const change = applySettings(tenant.settings, patch.value);
        if (change === null) return ok(tenant);
        await unit.tenants.mergeSettings(settingsToJson(patch.value));
        await unit.audit.record({
          actorUserId: ctx.userId,
          action: SETTINGS_UPDATED,
          entityType: "tenant",
          entityId: tenant.id,
          before: change.before,
          after: change.after,
          requestId: ctx.requestId,
        });
        return ok({ ...tenant, settings: change.settings });
      });
    },
  );
}

function planSnapshot(plan: Pick<Plan, "name" | "admissionFee" | "monthlyFee">) {
  return { name: plan.name, admissionFee: plan.admissionFee, monthlyFee: plan.monthlyFee };
}

/**
 * Edits a plan's name and fees, for the fee fields of the settings screen. Invoices already
 * generated keep the amounts they were made with, because an invoice stores its own lines and
 * total and never looks the plan price up again.
 */
export function makeUpdatePlan(deps: SettingsDeps) {
  return requirePermission<PlanUpdateInput, SettingsContext, Plan, SettingsError>(
    "settings.manage",
    async (input, ctx) => {
      const id = parseUuid(input.planId, "planId");
      if (!id.ok) return id;
      const fields = parsePlanFields(input);
      if (!fields.ok) return fields;
      return deps.withUnit(ctx.tenantId, async (unit): Promise<Result<Plan, SettingsError>> => {
        const plan = await unit.plans.findForUpdate(id.value);
        if (plan === null) return notFound("Plan not found");
        const unchanged =
          plan.name === fields.value.name &&
          plan.admissionFee === fields.value.admissionFee &&
          plan.monthlyFee === fields.value.monthlyFee;
        if (unchanged) return ok(plan);
        await unit.plans.update(plan.id, fields.value);
        await unit.audit.record({
          actorUserId: ctx.userId,
          action: PLAN_UPDATED,
          entityType: "plan",
          entityId: plan.id,
          before: planSnapshot(plan),
          after: planSnapshot(fields.value),
          requestId: ctx.requestId,
        });
        return ok({ ...plan, ...fields.value });
      });
    },
  );
}
