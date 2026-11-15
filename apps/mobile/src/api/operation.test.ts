import { describe, expect, expectTypeOf, it } from "vitest";
import { buildOperation, mutation, query } from "./operation";

describe("query", () => {
  it("prints a scalar root field", () => {
    const op = query("Health", { health: true });
    expect(op).toEqual({
      kind: "query",
      name: "Health",
      document: "query Health { health }",
      variables: {},
    });
    expectTypeOf<NonNullable<typeof op.__data>>().toEqualTypeOf<{ health: string }>();
  });

  it("prints nested selections and sends arguments as variables", () => {
    const op = query("Member", {
      member: { args: { id: "m1" }, select: { id: true, name: true } },
    });
    expect(op.document).toBe(
      "query Member($member_id: ID!) { member(id: $member_id) { id name } }",
    );
    expect(op.variables).toEqual({ member_id: "m1" });
    expectTypeOf<NonNullable<typeof op.__data>>().toEqualTypeOf<{
      member: { id: string; name: string | null } | null;
    }>();
  });

  it("omits the argument list when none is given", () => {
    const op = query("Members", {
      members: { select: { items: { id: true } } },
    });
    expect(op.document).toBe("query Members { members { items { id } } }");
    expect(op.variables).toEqual({});
  });

  it("types lists as arrays", () => {
    const op = query("Gyms", { myGyms: { select: { tenantId: true } } });
    expectTypeOf<NonNullable<typeof op.__data>>().toEqualTypeOf<{
      myGyms: { tenantId: string }[];
    }>();
  });

  it("fails the type check for a field the schema does not have", () => {
    // Never called: the point is that each line below is a compile error.
    const typeErrors = () => {
      // @ts-expect-error nope is not a Query field
      query("Bad", { nope: true });
      // @ts-expect-error nope is not a Member field
      query("Bad", { member: { args: { id: "m1" }, select: { nope: true } } });
      // @ts-expect-error nested typo inside a nested selection
      query("Bad", { members: { select: { items: { id: true, nope: true } } } });
    };
    expect(typeof typeErrors).toBe("function");
  });
});

describe("mutation", () => {
  it("builds a mutation with typed arguments", () => {
    const op = mutation("Scan", {
      recordScan: { args: { barcode: "b1" }, select: { errors: { message: true } } },
    });
    expect(op.kind).toBe("mutation");
    expect(op.document).toBe(
      "mutation Scan($recordScan_barcode: String!) { recordScan(barcode: $recordScan_barcode) { errors { message } } }",
    );
    expect(op.variables).toEqual({ recordScan_barcode: "b1" });
  });
});

describe("buildOperation", () => {
  it("rejects an unknown field or argument at runtime", () => {
    expect(() => buildOperation("query", "X", { nope: true })).toThrow("Unknown query field: nope");
    expect(() => buildOperation("mutation", "X", { nope: true })).toThrow(
      "Unknown mutation field: nope",
    );
    expect(() => buildOperation("query", "X", { member: { args: { nope: 1 } } })).toThrow(
      "Unknown argument nope on member",
    );
  });
});
