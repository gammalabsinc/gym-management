import { typeDefs } from "@gym/graphql-schema";
import { buildSchema } from "graphql";
import { describe, expect, it } from "vitest";
import {
  checkMutationGuards,
  IDENTITY_MUTATIONS,
  MUTATION_POLICY,
  type MutationGuardInput,
  type MutationPolicy,
  PENDING_MUTATIONS,
} from "./mutation-guard";
import { makeResolvers, type ResolverDeps } from "./resolvers";

const fakeDeps = {} as ResolverDeps;

const GUARDED: MutationPolicy = { permission: "payment.record", auditAction: "payment.record" };

function input(overrides: Partial<MutationGuardInput> = {}): MutationGuardInput {
  return {
    schemaMutations: ["recordPayment", "createMember"],
    resolverMutations: ["recordPayment"],
    policy: { recordPayment: GUARDED },
    pending: ["createMember"],
    ...overrides,
  };
}

describe("the real schema", () => {
  it("has every mutation guarded and audited, or not implemented yet", () => {
    const fields = buildSchema(typeDefs).getMutationType()?.getFields() ?? {};
    const resolvers = makeResolvers(fakeDeps).Mutation ?? {};
    const problems = checkMutationGuards({
      schemaMutations: Object.keys(fields),
      resolverMutations: Object.keys(resolvers),
      policy: MUTATION_POLICY,
      pending: PENDING_MUTATIONS,
      identity: IDENTITY_MUTATIONS,
    });
    expect(problems).toEqual([]);
  });

  it("finds mutations to check", () => {
    expect(Object.keys(buildSchema(typeDefs).getMutationType()?.getFields() ?? {})).not.toEqual([]);
  });
});

describe("identity mutations", () => {
  const withIdentity = (overrides: Partial<MutationGuardInput> = {}) =>
    input({
      schemaMutations: ["recordPayment", "createMember", "signIn"],
      pending: ["createMember"],
      identity: ["signIn"],
      ...overrides,
    });

  it("accepts a resolver for a mutation of the person, with no role policy", () => {
    expect(
      checkMutationGuards(withIdentity({ resolverMutations: ["recordPayment", "signIn"] })),
    ).toEqual([]);
  });

  it("fails an identity mutation that is also pending", () => {
    expect(checkMutationGuards(withIdentity({ pending: ["createMember", "signIn"] }))).toEqual([
      "signIn: listed as pending and also has a policy",
    ]);
  });

  it("fails an identity mutation that also has a role policy", () => {
    expect(
      checkMutationGuards(withIdentity({ policy: { recordPayment: GUARDED, signIn: GUARDED } })),
    ).toEqual(["signIn: is an identity mutation and also has a role policy"]);
  });

  it("fails an identity name that is not in the schema", () => {
    expect(checkMutationGuards(withIdentity({ identity: ["signIn", "ghost"] }))).toEqual([
      "ghost: declared but not a mutation in the schema",
    ]);
  });
});

describe("checkMutationGuards", () => {
  it("accepts a guarded, audited mutation next to a pending one", () => {
    expect(checkMutationGuards(input())).toEqual([]);
  });

  it("fails a mutation that is in the schema but neither guarded nor pending", () => {
    const problems = checkMutationGuards(input({ pending: [] }));
    expect(problems).toEqual(["createMember: no permission guard or audit event declared"]);
  });

  it("fails a mutation that is both pending and guarded", () => {
    const problems = checkMutationGuards(input({ pending: ["createMember", "recordPayment"] }));
    expect(problems).toEqual(["recordPayment: listed as pending and also has a policy"]);
  });

  it("fails a name that is not a mutation in the schema, in the policy or the pending list", () => {
    const problems = checkMutationGuards(
      input({
        policy: { recordPayment: GUARDED, ghost: GUARDED },
        pending: ["createMember", "gone"],
      }),
    );
    expect(problems).toEqual([
      "ghost: declared but not a mutation in the schema",
      "gone: declared but not a mutation in the schema",
    ]);
  });

  it("fails a resolver that has no policy entry", () => {
    const problems = checkMutationGuards(
      input({ resolverMutations: ["recordPayment", "createMember"] }),
    );
    expect(problems).toEqual(["createMember: has a resolver but no entry in MUTATION_POLICY"]);
  });

  it("ignores a policy key that is explicitly undefined", () => {
    const problems = checkMutationGuards(
      input({ policy: { recordPayment: GUARDED, createMember: undefined }, resolverMutations: [] }),
    );
    expect(problems).toEqual([]);
  });

  it("fails a permission that no role holds", () => {
    const unheld = { permission: "nobody.has.this", auditAction: "x" } as unknown as MutationPolicy;
    const problems = checkMutationGuards(input({ policy: { recordPayment: unheld } }));
    expect(problems).toEqual(['recordPayment: permission "nobody.has.this" is held by no role']);
  });

  it("fails an empty audit action", () => {
    const problems = checkMutationGuards(
      input({ policy: { recordPayment: { ...GUARDED, auditAction: "  " } } }),
    );
    expect(problems).toEqual(["recordPayment: no audit action declared"]);
  });

  it("reports every problem at once", () => {
    const bad = { permission: "nobody.has.this", auditAction: "" } as unknown as MutationPolicy;
    const problems = checkMutationGuards(input({ policy: { recordPayment: bad } }));
    expect(problems).toHaveLength(2);
  });
});
