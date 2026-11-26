import type { Client } from "../api/client";
import { mutation, query } from "../api/operation";

export interface SettingsData {
  readonly planId: string;
  readonly planName: string;
  readonly currency: string;
  readonly admissionFee: number;
  readonly monthlyFee: number;
  readonly warnDaysBefore: number;
  readonly redDaysAfter: number;
  readonly dupWindowMin: number;
  readonly referrerAmount: number;
  readonly referrerIsRecurring: boolean;
  readonly referredAmount: number;
  readonly referredIsRecurring: boolean;
  readonly details: {
    readonly name: string;
    readonly color: string | null;
    readonly timezone: string;
    readonly currency: string;
  };
}

export type LoadResult =
  | { readonly status: "loaded"; readonly data: SettingsData }
  | { readonly status: "forbidden" }
  | { readonly status: "failed"; readonly message: string };

export interface FieldProblem {
  readonly field: string | null;
  readonly message: string;
}

export type SaveResult =
  | { readonly status: "saved" }
  | { readonly status: "invalid"; readonly problems: readonly FieldProblem[] }
  | { readonly status: "forbidden" }
  | { readonly status: "failed"; readonly message: string };

export interface SettingsPatch {
  readonly warnDaysBefore: number;
  readonly redDaysAfter: number;
  readonly dupWindowMin: number;
  readonly referrerAmount: number;
  readonly referrerIsRecurring: boolean;
  readonly referredAmount: number;
  readonly referredIsRecurring: boolean;
}

export interface SettingsService {
  load(): Promise<LoadResult>;
  savePlan(plan: {
    readonly id: string;
    readonly name: string;
    readonly admissionFee: number;
    readonly monthlyFee: number;
  }): Promise<SaveResult>;
  saveSettings(input: SettingsPatch): Promise<SaveResult>;
}

export const NO_SETTINGS_MESSAGE = "We could not load the gym settings.";
export const SAVE_FAILED_MESSAGE = "We could not save the settings. Try again.";

const settingsQuery = query("GymSettings", {
  tenant: {
    select: {
      name: true,
      timezone: true,
      currency: true,
      branding: { primaryColor: true },
      settings: {
        warnDaysBefore: true,
        redDaysAfter: true,
        dupWindowMin: true,
        referrerAmount: true,
        referrerIsRecurring: true,
        referredAmount: true,
        referredIsRecurring: true,
      },
    },
  },
  plans: { select: { id: true, name: true, admissionFee: true, monthlyFee: true, isActive: true } },
});

const savePlanMutation = (plan: {
  id: string;
  name: string;
  admissionFee: number;
  monthlyFee: number;
}) =>
  mutation("SavePlan", {
    updatePlan: {
      args: {
        id: plan.id,
        input: { name: plan.name, admissionFee: plan.admissionFee, monthlyFee: plan.monthlyFee },
      },
      select: { plan: { id: true }, errors: { code: true, field: true, message: true } },
    },
  });

const saveSettingsMutation = (input: SettingsPatch) =>
  mutation("SaveSettings", {
    updateSettings: {
      args: { input },
      select: { tenant: { id: true }, errors: { code: true, field: true, message: true } },
    },
  });

interface Reported {
  readonly code: string;
  readonly field?: string | null;
  readonly message: string;
}

function toSave(
  outcome: {
    readonly status: string;
    readonly message?: string;
    readonly error?: { readonly code: string; readonly message: string };
  },
  errors: readonly Reported[] | null,
): SaveResult {
  if (outcome.status === "network")
    return { status: "failed", message: outcome.message ?? SAVE_FAILED_MESSAGE };
  if (outcome.status === "error") {
    return outcome.error?.code === "FORBIDDEN"
      ? { status: "forbidden" }
      : { status: "failed", message: outcome.error?.message ?? SAVE_FAILED_MESSAGE };
  }
  if (errors === null) return { status: "failed", message: SAVE_FAILED_MESSAGE };
  if (errors.some((error) => error.code === "FORBIDDEN")) return { status: "forbidden" };
  if (errors.length > 0) {
    return {
      status: "invalid",
      problems: errors.map((error) => ({ field: error.field ?? null, message: error.message })),
    };
  }
  return { status: "saved" };
}

export function createSettingsService(deps: {
  readonly client: Pick<Client, "execute">;
}): SettingsService {
  return {
    async load() {
      const outcome = await deps.client.execute(settingsQuery);
      if (outcome.status === "network") return { status: "failed", message: outcome.message };
      if (outcome.status === "error") {
        return outcome.error.code === "FORBIDDEN"
          ? { status: "forbidden" }
          : { status: "failed", message: outcome.error.message };
      }
      if (outcome.status === "empty") return { status: "failed", message: NO_SETTINGS_MESSAGE };
      const { tenant, plans } = outcome.data;
      // Each gym has one default plan, and its fees are edited here.
      const plan = plans.find((candidate) => candidate.isActive);
      if (plan === undefined) return { status: "failed", message: NO_SETTINGS_MESSAGE };
      return {
        status: "loaded",
        data: {
          planId: plan.id,
          planName: plan.name,
          currency: tenant.currency,
          admissionFee: plan.admissionFee,
          monthlyFee: plan.monthlyFee,
          ...tenant.settings,
          details: {
            name: tenant.name,
            color: tenant.branding.primaryColor ?? null,
            timezone: tenant.timezone,
            currency: tenant.currency,
          },
        },
      };
    },

    async savePlan(plan) {
      const outcome = await deps.client.execute(savePlanMutation(plan));
      return toSave(outcome, outcome.status === "data" ? outcome.data.updatePlan.errors : null);
    },

    async saveSettings(input) {
      const outcome = await deps.client.execute(saveSettingsMutation(input));
      return toSave(outcome, outcome.status === "data" ? outcome.data.updateSettings.errors : null);
    },
  };
}
