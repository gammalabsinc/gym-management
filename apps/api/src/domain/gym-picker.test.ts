import { describe, expect, it } from "vitest";
import { type GymSummary, rolesFromRows, sortGyms } from "./gym-picker";

function gym(tenantId: string, name: string): GymSummary {
  return { tenantId, name, subdomain: name.toLowerCase(), logoUrl: null, roles: ["member"] };
}

describe("rolesFromRows", () => {
  it("keeps the known roles in the order given and drops anything else", () => {
    expect(rolesFromRows(["owner", "staff", "member"])).toEqual(["owner", "staff", "member"]);
    expect(rolesFromRows(["staff", "janitor", "owner"])).toEqual(["staff", "owner"]);
    expect(rolesFromRows([])).toEqual([]);
  });
});

describe("sortGyms", () => {
  it("orders by name, then by id, and leaves the input alone", () => {
    const input = [gym("c", "Bravo"), gym("b", "Alpha"), gym("a", "Bravo")];
    expect(sortGyms(input).map((g) => g.tenantId)).toEqual(["b", "a", "c"]);
    expect(input.map((g) => g.tenantId)).toEqual(["c", "b", "a"]);
  });

  it("treats two rows with the same name and id as equal", () => {
    expect(sortGyms([gym("a", "Alpha"), gym("a", "Alpha")])).toHaveLength(2);
  });
});
