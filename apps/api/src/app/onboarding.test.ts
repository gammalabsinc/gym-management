import { describe, expect, it } from "vitest";
import type { Plan } from "../domain/plans";
import { makeOnboardGym, ROLE_ASSIGNED, TENANT_CREATED } from "./onboarding";
import type { AuditEvent, NewGymRow, OnboardUnit } from "./ports";

const NEW_ID = "11111111-1111-4111-8111-111111111111";
const EXISTING_ID = "22222222-2222-4222-8222-222222222222";
const OWNER_ID = "33333333-3333-4333-8333-333333333333";

const INPUT = {
  name: "Iron Works",
  subdomain: "Iron-Works",
  timezone: "America/Toronto",
  currency: "cad",
  ownerEmail: "Owner@Example.test",
  ownerName: "Sam Owner",
  admissionFee: 2000,
  monthlyFee: 5000,
};

interface World {
  subdomainTaken?: boolean;
  /** The gym exists but cannot be read back. */
  unreadable?: boolean;
  ownerCreated?: boolean;
  planExists?: boolean;
}

function setup(world: World = {}) {
  const opened: string[] = [];
  const gyms: NewGymRow[] = [];
  const users: { email: string; name: string | null }[] = [];
  const roles: { userId: string; role: string }[] = [];
  const plans: { key: string }[] = [];
  const audit: AuditEvent[] = [];
  const plan: Plan = {
    id: "plan-1",
    key: "default",
    name: "Default",
    admissionFee: 2000,
    monthlyFee: 5000,
    isActive: true,
  };
  const unit: OnboardUnit = {
    gyms: {
      insertIfAbsent: async (gym) => {
        if (world.subdomainTaken === true) return false;
        gyms.push(gym);
        return true;
      },
      findIdBySubdomain: async () => (world.unreadable === true ? null : EXISTING_ID),
    },
    staff: {
      createUser: async (user) => {
        if (world.ownerCreated === false) return null;
        users.push(user);
        return OWNER_ID;
      },
      addRole: async (userId, role) => {
        roles.push({ userId, role });
        return true;
      },
    },
    plans: {
      list: async () => [],
      findByKey: async () => plan,
      findMany: async () => [plan],
      findForUpdate: async () => plan,
      update: async () => {},
      insertIfAbsent: async (newPlan) => {
        plans.push({ key: newPlan.key });
        return world.planExists === true ? null : plan;
      },
    },
    audit: {
      record: async (event) => {
        audit.push(event);
      },
    },
  };
  const onboard = makeOnboardGym({
    ids: { next: () => NEW_ID },
    withUnit: async (tenantId, fn) => {
      opened.push(tenantId);
      return fn(unit);
    },
  });
  return { onboard, opened, gyms, users, roles, plans, audit };
}

describe("onboarding a gym", () => {
  it("adds the gym, its owner and its default plan in a transaction scoped to the new id", async () => {
    const { onboard, opened, gyms, users, roles, plans } = setup();
    const result = await onboard(INPUT, { requestId: "req-1" });
    expect(result).toEqual({
      ok: true,
      value: { tenantId: NEW_ID, subdomain: "iron-works", created: true },
    });
    expect(opened).toEqual([NEW_ID]);
    expect(gyms).toEqual([
      expect.objectContaining({
        id: NEW_ID,
        name: "Iron Works",
        subdomain: "iron-works",
        timezone: "America/Toronto",
        currency: "CAD",
      }),
    ]);
    expect(users).toEqual([{ email: "owner@example.test", name: "Sam Owner" }]);
    expect(roles).toEqual([{ userId: OWNER_ID, role: "owner" }]);
    expect(plans).toEqual([{ key: "default" }]);
  });

  it("writes an audit event for the gym, the owner and the plan, with no actor", async () => {
    const { onboard, audit } = setup();
    await onboard(INPUT, { requestId: "req-1" });
    expect(audit.map((event) => [event.action, event.entityType, event.entityId])).toEqual([
      ["plan.created", "plan", "plan-1"],
      [TENANT_CREATED, "tenant", NEW_ID],
      [ROLE_ASSIGNED, "user", OWNER_ID],
    ]);
    expect(audit.every((event) => event.actorUserId === null && event.requestId === "req-1")).toBe(
      true,
    );
    expect(audit[1]?.after).toEqual({
      name: "Iron Works",
      subdomain: "iron-works",
      timezone: "America/Toronto",
      currency: "CAD",
    });
    expect(audit[2]?.after).toEqual({
      email: "owner@example.test",
      name: "Sam Owner",
      roles: ["owner"],
    });
  });

  it("writes nothing and reports the gym that is there when the subdomain is taken", async () => {
    const { onboard, users, roles, plans, audit } = setup({ subdomainTaken: true });
    const result = await onboard(INPUT, { requestId: "req-1" });
    expect(result).toEqual({
      ok: true,
      value: { tenantId: EXISTING_ID, subdomain: "iron-works", created: false },
    });
    expect([users, roles, plans, audit]).toEqual([[], [], [], []]);
  });

  it("refuses an invalid gym before opening a transaction", async () => {
    const { onboard, opened } = setup();
    const result = await onboard(
      { ...INPUT, subdomain: "not valid", currency: "x" },
      { requestId: "r" },
    );
    expect(!result.ok && result.error.issues.map((issue) => issue.path[0])).toEqual([
      "subdomain",
      "currency",
    ]);
    expect(opened).toEqual([]);
  });

  it("throws when the rows a transaction should always hold are missing", async () => {
    await expect(
      setup({ subdomainTaken: true, unreadable: true }).onboard(INPUT, { requestId: "r" }),
    ).rejects.toThrow("exists but cannot be read");
    await expect(setup({ ownerCreated: false }).onboard(INPUT, { requestId: "r" })).rejects.toThrow(
      "already has a user",
    );
  });
});
