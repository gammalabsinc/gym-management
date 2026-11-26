import { describe, expect, it } from "vitest";
import { forbidden } from "../domain/errors";
import { ok } from "../domain/result";
import { type EnterGymDeps, makeEnterGym } from "./enter-gym";

const GYM = {
  tenantId: "t1",
  name: "Iron",
  subdomain: "iron",
  logoUrl: null,
  roles: ["owner" as const],
};
const ME = {
  userId: "u1",
  name: null,
  email: "a@b.test",
  roles: ["owner" as const],
  permissions: ["x"],
  memberId: null,
};
const TENANT = {
  kind: "member" as const,
  tenant: {
    id: "t1",
    name: "Iron",
    branding: { primaryColor: null, contactPhone: null, contactEmail: null, contactAddress: null },
  },
};
const session = { sessionId: "s1", subject: "sub" };

function setup(overrides: Partial<EnterGymDeps> = {}) {
  const calls: string[] = [];
  const deps: EnterGymDeps = {
    selectGym: async () => {
      calls.push("select");
      return ok(GYM);
    },
    findMembership: async () => ({ userId: "u1", gym: GYM }),
    whoAmI: async () => {
      calls.push("me");
      return ok(ME);
    },
    getTenant: async (_input, ctx) => {
      calls.push(`tenant:${ctx.roles.join()}:${ctx.requestId}`);
      return ok(TENANT);
    },
    newRequestId: () => "req-1",
    ...overrides,
  };
  return { enter: makeEnterGym(deps), calls };
}

describe("makeEnterGym", () => {
  it("binds the gym, then reads me and the gym profile with the roles from the gym", async () => {
    const { enter, calls } = setup();
    expect(await enter({ tenantId: "t1" }, session)).toEqual({
      ok: true,
      value: { me: ME, tenant: TENANT },
    });
    expect(calls).toEqual(["select", "me", "tenant:owner:req-1"]);
  });

  it("stops at a refused gym and reads nothing from it", async () => {
    const { enter, calls } = setup({ selectGym: async () => forbidden() });
    expect((await enter({ tenantId: "t1" }, session)).ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("is not found when the membership vanished after the bind", async () => {
    const { enter } = setup({ findMembership: async () => null });
    expect((await enter({ tenantId: "t1" }, session)).ok).toBe(false);
  });

  it("passes on a failed read of me", async () => {
    const { enter } = setup({
      whoAmI: async () => ({ ok: false, error: { kind: "not_found", message: "Not found" } }),
    });
    expect((await enter({ tenantId: "t1" }, session)).ok).toBe(false);
  });

  it("passes on a failed read of the gym profile", async () => {
    const { enter } = setup({ getTenant: async () => forbidden() });
    expect((await enter({ tenantId: "t1" }, session)).ok).toBe(false);
  });
});
