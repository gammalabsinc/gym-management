import { describe, expect, it } from "vitest";
import type { GymSummary } from "../domain/gym-picker";
import { makeFindMembership } from "./gym-membership";
import type { GymAccount, GymPickerUnit } from "./ports";

const GYM_A = "11111111-1111-4111-8111-111111111111";
const GYM_B = "22222222-2222-4222-8222-222222222222";

const gymA: GymSummary = {
  tenantId: GYM_A,
  name: "Alpha",
  subdomain: "alpha",
  logoUrl: null,
  roles: ["member"],
};

function setup(accounts: GymAccount[], found: GymSummary | null) {
  const reads: { tenantId: string; userId: string }[] = [];
  const find = makeFindMembership({
    accounts: { gymsOf: async () => accounts },
    withUnit: async (tenantId, fn) => {
      const unit: GymPickerUnit = {
        gyms: {
          find: async (userId) => {
            reads.push({ tenantId, userId });
            return found;
          },
        },
      };
      return fn(unit);
    },
  });
  return { find, reads };
}

describe("finding a membership", () => {
  it("returns the user row and the gym when the person holds a role there", async () => {
    const { find, reads } = setup([{ tenantId: GYM_A, userId: "u1" }], gymA);
    expect(await find("subject", GYM_A)).toEqual({ userId: "u1", gym: gymA });
    expect(reads).toEqual([{ tenantId: GYM_A, userId: "u1" }]);
  });

  it("is null, and reads no gym, when the person has no user row in that gym", async () => {
    const { find, reads } = setup([{ tenantId: GYM_B, userId: "u2" }], gymA);
    expect(await find("subject", GYM_A)).toBeNull();
    expect(reads).toEqual([]);
  });

  it("is null when the user row holds no role or the gym is switched off", async () => {
    const { find } = setup([{ tenantId: GYM_A, userId: "u1" }], null);
    expect(await find("subject", GYM_A)).toBeNull();
  });
});
