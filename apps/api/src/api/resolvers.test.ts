import type { Resolvers } from "@gym/graphql-schema";
import { describe, expect, it } from "vitest";
import type { GraphQLContext } from "./context";
import { toGqlMember } from "./mappers";
import { makeResolvers, type ResolverDeps } from "./resolvers";

describe("makeResolvers", () => {
  it("answers the health query", () => {
    const health = makeResolvers().Query?.health;
    expect(typeof health).toBe("function");
    expect((health as () => string)()).toBe("ok");
  });
});

// Type level check for the done-when: a resolver that drifts from the schema must not compile.
// If the expected error ever disappears, tsc fails on the unused directive.
const drifted: Resolvers<GraphQLContext> = {
  Query: {
    // @ts-expect-error health is String!, so a number is a schema drift
    health: () => 42,
  },
};

it("keeps the drift check in the type checker's view", () => {
  expect(drifted.Query).toBeDefined();
});

describe("Member.referredBy", () => {
  const view = (id: string, referredBy: string | null) => ({
    id,
    memberNo: "ABC123",
    barcode: "b",
    name: id,
    email: `${id}@x.test`,
    phone: null,
    photoRef: null,
    status: "active" as const,
    plan: { id: "p", key: "k", name: "Basic", admissionFee: 0, monthlyFee: 1, isActive: true },
    joinedOn: "2026-01-01",
    leftOn: null,
    billingDay: 1,
    referredBy,
    paidThrough: null,
    standing: "paid" as const,
    balanceDue: 0,
    credit: 0,
    visitsThisMonth: 0,
    visitsLastMonth: 0,
    totalPaid: 0,
  });
  const field = makeResolvers({} as ResolverDeps).Member?.referredBy as unknown as (
    parent: unknown,
    args: object,
    ctx: unknown,
  ) => Promise<{ id: string } | null>;
  const ctx = (known: Record<string, ReturnType<typeof view>>) => ({
    loaders: { member: { load: async (id: string) => known[id] ?? null } },
  });

  it("loads the referrer through the request loader", async () => {
    const referrer = view("r1", null);
    const referred = toGqlMember(view("m1", "r1"));
    expect((await field(referred, {}, ctx({ r1: referrer })))?.id).toBe("r1");
  });

  it("is null for a member nobody referred, a referrer that is gone, and no loaders", async () => {
    expect(await field(toGqlMember(view("m1", null)), {}, ctx({}))).toBeNull();
    expect(await field(toGqlMember(view("m1", "gone")), {}, ctx({}))).toBeNull();
    expect(await field(toGqlMember(view("m1", "r1")), {}, { loaders: null })).toBeNull();
  });
});
