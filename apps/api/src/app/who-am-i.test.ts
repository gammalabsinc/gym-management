import { describe, expect, it } from "vitest";
import type { WhoAmIRecord, WhoAmIUnit } from "./ports";
import { makeWhoAmI } from "./who-am-i";

function setup(record: WhoAmIRecord | null) {
  const seen: string[] = [];
  const whoAmI = makeWhoAmI({
    withUnit: async (tenantId, fn) => {
      seen.push(tenantId);
      const unit: WhoAmIUnit = { me: { find: async () => record } };
      return fn(unit);
    },
  });
  return { whoAmI, seen };
}

const caller = { tenantId: "t1", userId: "u1" };

describe("makeWhoAmI", () => {
  it("returns the person with the permissions of all their roles, once each", async () => {
    const { whoAmI, seen } = setup({
      userId: "u1",
      name: "Sam",
      email: "sam@x.test",
      roles: ["staff", "member"],
      memberId: "m1",
    });
    const result = await whoAmI(undefined, caller);
    expect(result.ok && result.value.permissions).toEqual(
      [
        ...new Set([
          "member.read",
          "member.read.own",
          "member.create",
          "member.update",
          "member.pause",
          "payment.record",
          "scan.record",
        ]),
      ].sort(),
    );
    expect(result.ok && result.value.memberId).toBe("m1");
    expect(seen).toEqual(["t1"]);
  });

  it("is not found when the user row is gone or switched off", async () => {
    const { whoAmI } = setup(null);
    expect(await whoAmI(undefined, caller)).toEqual({
      ok: false,
      error: { kind: "not_found", message: "Not found" },
    });
  });
});
