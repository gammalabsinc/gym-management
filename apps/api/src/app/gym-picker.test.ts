import { describe, expect, it } from "vitest";
import type { GymSummary } from "../domain/gym-picker";
import { makeListMyGyms } from "./gym-picker";
import type { AccountLookup, GymAccount, GymPickerUnit } from "./ports";

function summary(tenantId: string, name: string, roles: GymSummary["roles"]): GymSummary {
  return { tenantId, name, subdomain: name.toLowerCase(), logoUrl: null, roles };
}

function setup(accounts: GymAccount[], gyms: Record<string, GymSummary | null>) {
  const lookups: string[] = [];
  const reads: { tenantId: string; userId: string }[] = [];
  const lookup: AccountLookup = {
    gymsOf: async (subject) => {
      lookups.push(subject);
      return accounts;
    },
  };
  const list = makeListMyGyms({
    accounts: lookup,
    withUnit: async (tenantId, fn) => {
      const unit: GymPickerUnit = {
        gyms: {
          find: async (userId) => {
            reads.push({ tenantId, userId });
            return gyms[tenantId] ?? null;
          },
        },
      };
      return fn(unit);
    },
  });
  return { list, lookups, reads };
}

describe("listing my gyms", () => {
  it("reads each gym in its own tenant for the user row there, and sorts by name", async () => {
    const { list, lookups, reads } = setup(
      [
        { tenantId: "t1", userId: "u1" },
        { tenantId: "t2", userId: "u2" },
      ],
      {
        t1: summary("t1", "Zeta Gym", ["member"]),
        t2: summary("t2", "Alpha Gym", ["owner", "staff"]),
      },
    );
    const result = await list(undefined, { subject: "google-subject" });
    expect(result.ok && result.value.map((gym) => gym.name)).toEqual(["Alpha Gym", "Zeta Gym"]);
    expect(lookups).toEqual(["google-subject"]);
    expect(reads).toEqual([
      { tenantId: "t1", userId: "u1" },
      { tenantId: "t2", userId: "u2" },
    ]);
  });

  it("leaves out a gym where the person holds no role", async () => {
    const { list } = setup(
      [
        { tenantId: "t1", userId: "u1" },
        { tenantId: "t2", userId: "u2" },
      ],
      { t1: null, t2: summary("t2", "Alpha Gym", ["member"]) },
    );
    const result = await list(undefined, { subject: "s" });
    expect(result.ok && result.value.map((gym) => gym.tenantId)).toEqual(["t2"]);
  });

  it("returns an empty list for a person who belongs to no gym", async () => {
    const { list, reads } = setup([], {});
    expect(await list(undefined, { subject: "s" })).toEqual({ ok: true, value: [] });
    expect(reads).toEqual([]);
  });

  it("refuses a session with no subject without looking anything up", async () => {
    for (const subject of ["", "   "]) {
      const { list, lookups } = setup([{ tenantId: "t1", userId: "u1" }], {});
      const result = await list(undefined, { subject });
      expect(!result.ok && result.error.kind).toBe("unauthenticated");
      expect(lookups).toEqual([]);
    }
  });
});
