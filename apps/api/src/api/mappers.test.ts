import { describe, expect, it } from "vitest";
import { toGqlGym, toGqlRole, toGqlTenant, toGraphQLError, toUserErrors } from "./mappers";

describe("mappers", () => {
  it("upper cases a role for the enum", () => {
    expect(toGqlRole("owner")).toBe("OWNER");
  });

  it("maps a gym with its roles", () => {
    expect(
      toGqlGym({
        tenantId: "t",
        name: "n",
        subdomain: "s",
        logoUrl: null,
        roles: ["staff", "member"],
      }),
    ).toEqual({
      tenantId: "t",
      name: "n",
      logoUrl: null,
      roles: ["STAFF", "MEMBER"],
    });
  });

  it("hands the tenant view through", () => {
    const tenant = { id: "t", name: "n", branding: {} };
    expect(toGqlTenant({ kind: "member", tenant: tenant as never })).toBe(tenant);
  });

  it("maps a validation error to one user error per issue, with the field path", () => {
    expect(
      toUserErrors({
        kind: "validation",
        message: "Invalid input",
        issues: [
          { path: ["input", "email"], message: "bad" },
          { path: [], message: "worse" },
        ],
      }),
    ).toEqual([
      { code: "INVALID_INPUT", field: "input.email", message: "bad" },
      { code: "INVALID_INPUT", field: null, message: "worse" },
    ]);
  });

  it("maps a validation error without issues to one user error", () => {
    expect(toUserErrors({ kind: "validation", message: "Invalid input", issues: [] })).toEqual([
      { code: "INVALID_INPUT", field: null, message: "Invalid input" },
    ]);
  });

  it("maps each other kind to its code", () => {
    const code = (kind: "unauthenticated" | "forbidden" | "not_found" | "conflict") =>
      toUserErrors({ kind, message: "m" })[0]?.code;
    expect([
      code("unauthenticated"),
      code("forbidden"),
      code("not_found"),
      code("conflict"),
    ]).toEqual(["FORBIDDEN", "FORBIDDEN", "NOT_FOUND", "CONFLICT"]);
  });

  it("throws a query error with the client code of its kind", () => {
    expect(
      toGraphQLError({ kind: "unauthenticated", message: "Sign in required" }).extensions,
    ).toEqual({ code: "UNAUTHENTICATED" });
  });
});
