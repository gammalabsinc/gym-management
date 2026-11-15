import { buildSchema, parse, validate } from "graphql";
import { describe, expect, it } from "vitest";
import { noIntrospectionRule, queryLimitsRule } from "./limits";

const schema = buildSchema(`
  type Node { id: ID! child: Node children: [Node!]! }
  type Query { node: Node! }
`);

function codes(query: string, rule: ReturnType<typeof queryLimitsRule>) {
  return validate(schema, parse(query), [rule]).map((e) => e.extensions.code);
}

const limits = { maxDepth: 3, maxCost: 6 };

describe("queryLimitsRule", () => {
  it("accepts a shallow, small query", () => {
    expect(codes("{ node { id child { id } } }", queryLimitsRule(limits))).toEqual([]);
  });

  it("rejects a query nested past the depth limit", () => {
    const query = "{ node { child { child { child { id } } } } }";
    expect(codes(query, queryLimitsRule(limits))).toEqual(["QUERY_TOO_DEEP"]);
  });

  it("rejects a query that selects too many fields", () => {
    const query = "{ node { a: id b: id c: id d: id e: id f: id } }";
    expect(codes(query, queryLimitsRule(limits))).toEqual(["QUERY_TOO_COSTLY"]);
  });

  it("counts depth and cost through named and inline fragments", () => {
    const deep = `
      { node { ...A } }
      fragment A on Node { child { ... on Node { child { child { id } } } } }
    `;
    expect(codes(deep, queryLimitsRule(limits))).toEqual(["QUERY_TOO_DEEP"]);
  });

  it("does not loop on a fragment cycle or follow an unknown fragment", () => {
    const query = `
      { node { ...A ...Missing } }
      fragment A on Node { id ...A }
    `;
    const found = validate(schema, parse(query), [queryLimitsRule(limits)]);
    expect(found.map((e) => e.extensions.code)).toEqual([]);
  });

  it("stops walking a huge query early and still rejects it", () => {
    const fields = Array.from({ length: 5000 }, (_, i) => `f${i}: id`).join(" ");
    expect(codes(`{ node { ${fields} } }`, queryLimitsRule(limits))).toEqual(["QUERY_TOO_COSTLY"]);
  });
});

describe("noIntrospectionRule", () => {
  it("rejects schema and type lookups", () => {
    const found = validate(
      schema,
      parse('{ __schema { types { name } } __type(name: "Node") { name } }'),
      [noIntrospectionRule],
    );
    expect(found.map((e) => e.extensions.code)).toEqual([
      "INTROSPECTION_DISABLED",
      "INTROSPECTION_DISABLED",
    ]);
  });

  it("still allows __typename", () => {
    expect(validate(schema, parse("{ node { __typename } }"), [noIntrospectionRule])).toEqual([]);
  });
});
