import { describe, expect, it } from "vitest";
import type { Role } from "../domain/permissions";
import type { Plan } from "../domain/plans";
import { DEFAULT_SETTINGS, type Tenant } from "../domain/tenant";
import type { AuditEvent, SettingsUnit } from "./ports";
import {
  makeGetTenant,
  makeUpdatePlan,
  makeUpdateSettings,
  type SettingsContext,
  type SettingsDeps,
} from "./tenant-settings";

const ACTOR = "00000000-0000-4000-8000-0000000000a1";
const PLAN_ID = "00000000-0000-4000-8000-0000000000b1";
const OTHER_PLAN = "00000000-0000-4000-8000-0000000000b2";

const TENANT: Tenant = {
  id: "tenant-1",
  name: "Iron Gym",
  subdomain: "iron",
  timezone: "America/Toronto",
  currency: "CAD",
  branding: {
    logoUrl: "https://x.test/logo.png",
    primaryColor: "#112233",
    contactPhone: "555",
    contactEmail: "hi@x.test",
    contactAddress: "1 Main St",
  },
  settings: DEFAULT_SETTINGS,
};

const PLAN: Plan = {
  id: PLAN_ID,
  key: "default",
  name: "Default",
  admissionFee: 2000,
  monthlyFee: 5000,
  isActive: true,
};

function ctx(roles: Role[]): SettingsContext {
  return { roles, tenantId: "tenant-1", userId: ACTOR, requestId: "req-1" };
}

function world(options: { tenant?: Tenant | null; plans?: Plan[] } = {}) {
  let tenant = options.tenant === undefined ? TENANT : options.tenant;
  const plans = [...(options.plans ?? [PLAN])];
  const events: AuditEvent[] = [];
  const merged: Record<string, number | boolean>[] = [];
  const tenants: string[] = [];
  const unit: SettingsUnit = {
    tenants: {
      find: async () => tenant,
      findForUpdate: async () => tenant,
      mergeSettings: async (json) => {
        merged.push({ ...json });
        if (tenant !== null) tenant = { ...tenant };
      },
    },
    plans: {
      list: async () => plans,
      findByKey: async (key) => plans.find((plan) => plan.key === key) ?? null,
      findForUpdate: async (id) => plans.find((plan) => plan.id === id) ?? null,
      update: async (id, fields) => {
        const index = plans.findIndex((plan) => plan.id === id);
        const existing = plans[index];
        if (existing !== undefined) plans[index] = { ...existing, ...fields };
      },
      insertIfAbsent: async () => null,
    },
    audit: {
      record: async (event) => {
        events.push(event);
      },
    },
  };
  const deps: SettingsDeps = {
    withUnit: async (tenantId, fn) => {
      tenants.push(tenantId);
      return fn(unit);
    },
  };
  return { deps, events, merged, plans, tenants };
}

describe("getTenant", () => {
  it("gives an owner and a staff member the whole profile", async () => {
    const w = world();
    for (const roles of [["owner"], ["staff"], ["member", "staff"]] as Role[][]) {
      expect(await makeGetTenant(w.deps)(undefined, ctx(roles))).toEqual({
        ok: true,
        value: { kind: "full", tenant: TENANT },
      });
    }
    expect(w.tenants).toEqual(["tenant-1", "tenant-1", "tenant-1"]);
  });

  it("gives a member the name, colour and contact details only", async () => {
    const result = await makeGetTenant(world().deps)(undefined, ctx(["member"]));
    expect(result).toEqual({
      ok: true,
      value: {
        kind: "member",
        tenant: {
          id: "tenant-1",
          name: "Iron Gym",
          branding: {
            primaryColor: "#112233",
            contactPhone: "555",
            contactEmail: "hi@x.test",
            contactAddress: "1 Main St",
          },
        },
      },
    });
    const text = JSON.stringify(result);
    for (const secret of [
      "subdomain",
      "timezone",
      "currency",
      "settings",
      "warnDaysBefore",
      "logo",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("refuses a caller with no role in the gym, before reading anything", async () => {
    const w = world();
    expect(await makeGetTenant(w.deps)(undefined, ctx([]))).toEqual({
      ok: false,
      error: { kind: "forbidden", message: "Not allowed" },
    });
    expect(w.tenants).toEqual([]);
  });

  it("answers not found when the gym row is gone", async () => {
    const result = await makeGetTenant(world({ tenant: null }).deps)(undefined, ctx(["owner"]));
    expect(result).toEqual({ ok: false, error: { kind: "not_found", message: "Gym not found" } });
  });
});

describe("updateSettings", () => {
  it("lets only an owner update, and a refused caller reaches nothing", async () => {
    const w = world();
    for (const roles of [["staff"], ["member"], []] as Role[][]) {
      const result = await makeUpdateSettings(w.deps)({ warnDaysBefore: 9 }, ctx(roles));
      expect(!result.ok && result.error.kind).toBe("forbidden");
    }
    expect(w.tenants).toEqual([]);
    expect(w.merged).toEqual([]);
    expect(w.events).toEqual([]);
  });

  it("merges the changed settings and audits the old and new values", async () => {
    const w = world();
    const result = await makeUpdateSettings(w.deps)(
      { warnDaysBefore: 7, redDaysAfter: 5, referrerAmount: 500, referrerIsRecurring: true },
      ctx(["owner"]),
    );
    expect(result.ok && result.value.settings).toEqual({
      ...DEFAULT_SETTINGS,
      warnDaysBefore: 7,
      referrerAmount: 500,
      referrerIsRecurring: true,
    });
    expect(w.merged).toEqual([
      { warn_days_before: 7, red_days_after: 5, referrer_amount: 500, referrer_is_recurring: true },
    ]);
    expect(w.events).toEqual([
      {
        actorUserId: ACTOR,
        action: "settings.updated",
        entityType: "tenant",
        entityId: "tenant-1",
        before: { warnDaysBefore: 5, referrerAmount: 0, referrerIsRecurring: false },
        after: { warnDaysBefore: 7, referrerAmount: 500, referrerIsRecurring: true },
        requestId: "req-1",
      },
    ]);
  });

  it("writes nothing when the values are the ones the gym already has", async () => {
    const w = world();
    const same = await makeUpdateSettings(w.deps)({ warnDaysBefore: 5 }, ctx(["owner"]));
    const empty = await makeUpdateSettings(w.deps)({}, ctx(["owner"]));
    expect(same.ok && empty.ok).toBe(true);
    expect(w.merged).toEqual([]);
    expect(w.events).toEqual([]);
  });

  it("refuses an invalid value before opening a transaction", async () => {
    const w = world();
    const result = await makeUpdateSettings(w.deps)({ referredAmount: -1 }, ctx(["owner"]));
    expect(!result.ok && result.error.kind).toBe("validation");
    expect(w.tenants).toEqual([]);
  });

  it("answers not found when the gym row is gone", async () => {
    const w = world({ tenant: null });
    const result = await makeUpdateSettings(w.deps)({ warnDaysBefore: 9 }, ctx(["owner"]));
    expect(!result.ok && result.error.kind).toBe("not_found");
    expect(w.events).toEqual([]);
  });
});

describe("updatePlan", () => {
  const input = { planId: PLAN_ID, name: " Standard ", admissionFee: 2500, monthlyFee: 5500 };

  it("lets only an owner edit a plan", async () => {
    const w = world();
    const result = await makeUpdatePlan(w.deps)(input, ctx(["staff"]));
    expect(!result.ok && result.error.kind).toBe("forbidden");
    expect(w.plans).toEqual([PLAN]);
  });

  it("changes the name and fees and audits the old and new values", async () => {
    const w = world();
    const result = await makeUpdatePlan(w.deps)(input, ctx(["owner"]));
    const updated = { ...PLAN, name: "Standard", admissionFee: 2500, monthlyFee: 5500 };
    expect(result).toEqual({ ok: true, value: updated });
    expect(w.plans).toEqual([updated]);
    expect(w.events).toEqual([
      {
        actorUserId: ACTOR,
        action: "plan.updated",
        entityType: "plan",
        entityId: PLAN_ID,
        before: { name: "Default", admissionFee: 2000, monthlyFee: 5000 },
        after: { name: "Standard", admissionFee: 2500, monthlyFee: 5500 },
        requestId: "req-1",
      },
    ]);
  });

  it("writes nothing when nothing changes", async () => {
    const w = world();
    const result = await makeUpdatePlan(w.deps)(
      { planId: PLAN_ID, name: "Default", admissionFee: 2000, monthlyFee: 5000 },
      ctx(["owner"]),
    );
    expect(result).toEqual({ ok: true, value: PLAN });
    expect(w.events).toEqual([]);
  });

  it("detects a change in any one of the three fields", async () => {
    for (const change of [{ name: "Other" }, { admissionFee: 1 }, { monthlyFee: 1 }]) {
      const w = world();
      await makeUpdatePlan(w.deps)(
        { planId: PLAN_ID, name: "Default", admissionFee: 2000, monthlyFee: 5000, ...change },
        ctx(["owner"]),
      );
      expect(w.events).toHaveLength(1);
    }
  });

  it("answers not found for an unknown plan", async () => {
    const result = await makeUpdatePlan(world().deps)(
      { ...input, planId: OTHER_PLAN },
      ctx(["owner"]),
    );
    expect(result).toEqual({ ok: false, error: { kind: "not_found", message: "Plan not found" } });
  });

  it("refuses a bad id, a negative fee and a blank name before opening a transaction", async () => {
    const w = world();
    const bad = [
      { ...input, planId: "x" },
      { ...input, monthlyFee: -1 },
      { ...input, name: "  " },
    ];
    for (const attempt of bad) {
      const result = await makeUpdatePlan(w.deps)(attempt, ctx(["owner"]));
      expect(!result.ok && result.error.kind).toBe("validation");
    }
    expect(w.tenants).toEqual([]);
  });
});
