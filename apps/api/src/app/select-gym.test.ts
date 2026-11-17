import { describe, expect, it } from "vitest";
import type { GymSummary } from "../domain/gym-picker";
import type { FindMembership } from "./gym-membership";
import { makeSelectGym, NOT_A_MEMBER_MESSAGE } from "./select-gym";

const GYM = "11111111-1111-4111-8111-111111111111";
const ctx = { sessionId: "session-1", subject: "subject-1" };

const summary: GymSummary = {
  tenantId: GYM,
  name: "Alpha",
  subdomain: "alpha",
  logoUrl: null,
  roles: ["staff"],
};

function setup(options: { active?: boolean; membership?: boolean } = {}) {
  const bound: { sessionId: string; gymId: string }[] = [];
  const checked: string[] = [];
  const findMembership: FindMembership = async (subject, gymId) => {
    checked.push(`${subject}:${gymId}`);
    return options.membership === false ? null : { userId: "u1", gym: summary };
  };
  const select = makeSelectGym({
    gyms: { isActive: async () => options.active !== false },
    findMembership,
    sessions: {
      bindGym: async (sessionId, gymId) => {
        bound.push({ sessionId, gymId });
      },
    },
  });
  return { select, bound, checked };
}

describe("selecting a gym", () => {
  it("binds the session to the gym when the person holds a role there", async () => {
    const { select, bound, checked } = setup();
    const result = await select({ tenantId: GYM }, ctx);
    expect(result).toEqual({ ok: true, value: summary });
    expect(bound).toEqual([{ sessionId: "session-1", gymId: GYM }]);
    expect(checked).toEqual([`subject-1:${GYM}`]);
  });

  it("accepts the id in upper case and binds it in lower case", async () => {
    const { select, bound } = setup();
    await select({ tenantId: ` ${GYM.toUpperCase()} ` }, ctx);
    expect(bound).toEqual([{ sessionId: "session-1", gymId: GYM }]);
  });

  it("refuses a person with no role in the gym, and binds nothing", async () => {
    const { select, bound } = setup({ membership: false });
    const result = await select({ tenantId: GYM }, ctx);
    expect(result).toMatchObject({ ok: false, error: { kind: "forbidden" } });
    expect(!result.ok && result.error.message).toBe(NOT_A_MEMBER_MESSAGE);
    expect(bound).toEqual([]);
  });

  it("gives a generic not found for a gym that is unknown or switched off", async () => {
    const { select, bound, checked } = setup({ active: false });
    const result = await select({ tenantId: GYM }, ctx);
    expect(result).toEqual({ ok: false, error: { kind: "not_found", message: "Not found" } });
    expect(bound).toEqual([]);
    expect(checked).toEqual([]);
  });

  it("gives the same not found for an id that is not a uuid, without asking the database", async () => {
    const { select, checked } = setup();
    const result = await select({ tenantId: "not-a-gym" }, ctx);
    expect(result).toEqual({ ok: false, error: { kind: "not_found", message: "Not found" } });
    expect(checked).toEqual([]);
  });
});
