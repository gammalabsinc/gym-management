import { describe, expect, it } from "vitest";
import type { Plan } from "../domain/plans";
import { makeListPlans, makeSeedDefaultPlan, type PlanContext } from "./plans";
import type { AuditEvent, PlanStore, PlanUnit } from "./ports";

const ctx: PlanContext = { tenantId: "tenant-1", requestId: "req-1" };

function world(initial: Plan[] = []) {
  const plans = [...initial];
  const events: AuditEvent[] = [];
  const tenants: string[] = [];
  const hooks = { hideAfterConflict: false };
  const store: PlanStore = {
    async list() {
      return plans;
    },
    async findByKey(key) {
      return hooks.hideAfterConflict ? null : (plans.find((plan) => plan.key === key) ?? null);
    },
    async findForUpdate(id) {
      return plans.find((plan) => plan.id === id) ?? null;
    },
    async update() {},
    async insertIfAbsent(plan) {
      if (plans.some((existing) => existing.key === plan.key)) return null;
      const created: Plan = { ...plan, id: `plan-${plans.length + 1}`, isActive: true };
      plans.push(created);
      return created;
    },
  };
  const unit: PlanUnit = {
    plans: store,
    audit: {
      async record(event) {
        events.push(event);
      },
    },
  };
  const deps = {
    withUnit: async <T>(tenantId: string, fn: (u: PlanUnit) => Promise<T>) => {
      tenants.push(tenantId);
      return fn(unit);
    },
  };
  return { deps, plans, events, tenants, hooks };
}

describe("listPlans", () => {
  it("returns every plan of the gym, archived ones included", async () => {
    const archived: Plan = {
      id: "a",
      key: "old",
      name: "Old",
      admissionFee: 0,
      monthlyFee: 100,
      isActive: false,
    };
    const w = world([archived]);
    expect(await makeListPlans(w.deps)(undefined, ctx)).toEqual({ ok: true, value: [archived] });
    expect(w.tenants).toEqual(["tenant-1"]);
  });
});

describe("seedDefaultPlan", () => {
  it("creates the default plan and one system audit event", async () => {
    const w = world();
    const result = await makeSeedDefaultPlan(w.deps)({ admissionFee: 2000, monthlyFee: 5000 }, ctx);
    expect(result).toEqual({
      ok: true,
      value: {
        created: true,
        plan: {
          id: "plan-1",
          key: "default",
          name: "Default",
          admissionFee: 2000,
          monthlyFee: 5000,
          isActive: true,
        },
      },
    });
    expect(w.events).toEqual([
      {
        actorUserId: null,
        action: "plan.created",
        entityType: "plan",
        entityId: "plan-1",
        before: null,
        after: { key: "default", name: "Default", admissionFee: 2000, monthlyFee: 5000 },
        requestId: "req-1",
      },
    ]);
  });

  it("changes nothing when the gym already has its default plan", async () => {
    const w = world();
    const seed = makeSeedDefaultPlan(w.deps);
    await seed({ admissionFee: 2000, monthlyFee: 5000 }, ctx);
    const again = await seed({ admissionFee: 9999, monthlyFee: 9999 }, ctx);
    expect(again.ok && again.value.created).toBe(false);
    expect(again.ok && again.value.plan.monthlyFee).toBe(5000);
    expect(w.plans).toHaveLength(1);
    expect(w.events).toHaveLength(1);
  });

  it("rejects bad fees before opening a transaction", async () => {
    const w = world();
    const result = await makeSeedDefaultPlan(w.deps)({ admissionFee: -5, monthlyFee: 1 }, ctx);
    expect(!result.ok && result.error.kind).toBe("validation");
    expect(w.tenants).toEqual([]);
  });

  it("throws when the plan exists but cannot be read, since that is a bug", async () => {
    const w = world();
    const seed = makeSeedDefaultPlan(w.deps);
    await seed({ admissionFee: 1, monthlyFee: 1 }, ctx);
    w.hooks.hideAfterConflict = true;
    await expect(seed({ admissionFee: 1, monthlyFee: 1 }, ctx)).rejects.toThrow("cannot be read");
  });
});
