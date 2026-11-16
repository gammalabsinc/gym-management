import { describe, expect, it } from "vitest";
import { hasPermission, permissionsOf, ROLE_PERMISSIONS, ROLES } from "./permissions";

describe("ROLE_PERMISSIONS", () => {
  it("lists every role", () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ROLES].sort());
  });

  it("lists no permission twice for a role", () => {
    for (const role of ROLES) {
      const list = permissionsOf(role);
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it("gives the owner every permission that any role holds", () => {
    const owner = permissionsOf("owner");
    for (const role of ROLES) {
      for (const permission of permissionsOf(role)) expect(owner).toContain(permission);
    }
  });

  it("gives a member no permission", () => {
    expect(permissionsOf("member")).toEqual([]);
  });

  it("keeps cancelling a membership with the owner by default", () => {
    expect(hasPermission(["owner"], "member.cancel")).toBe(true);
    expect(hasPermission(["staff"], "member.cancel")).toBe(false);
  });
});

describe("hasPermission", () => {
  it("allows a permission the role holds", () => {
    expect(hasPermission(["staff"], "payment.record")).toBe(true);
  });

  it("allows when any one of several roles holds it", () => {
    expect(hasPermission(["member", "staff"], "scan.record")).toBe(true);
  });

  it("denies a permission the role does not hold", () => {
    expect(hasPermission(["staff"], "role.manage")).toBe(false);
  });

  it("denies when there are no roles", () => {
    expect(hasPermission([], "payment.record")).toBe(false);
  });

  it("denies a permission string that no role lists", () => {
    expect(hasPermission(["owner", "staff", "member"], "nothing.at.all")).toBe(false);
  });
});
