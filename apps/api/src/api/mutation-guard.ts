import type { Mutation } from "@gym/graphql-schema";
import { hasPermission, type Permission, ROLES } from "../domain/permissions";

export type MutationName = Exclude<keyof Mutation, "__typename">;

/** What a mutation declares: the permission that guards it and the audit event it writes. */
export interface MutationPolicy {
  readonly permission: Permission;
  readonly auditAction: string;
}

/**
 * The policy of every mutation that is implemented. The ticket that implements a mutation adds
 * its entry here, in the same change as the resolver. A resolver without an entry fails the
 * guard test, so a mutation cannot ship unguarded or unaudited.
 */
export const MUTATION_POLICY: Readonly<Partial<Record<MutationName, MutationPolicy>>> = {};

/**
 * Mutations that are in schema.graphql but not implemented yet. The ticket that implements one
 * moves it from this list to MUTATION_POLICY. Adding a name here to get past the guard test is
 * visible in review, and the test still fails for a name that is in neither place.
 */
export const PENDING_MUTATIONS: readonly MutationName[] = [
  "selectGym",
  "recordScan",
  "createMember",
  "updateMember",
  "recordPayment",
  "voidPayment",
  "voidInvoice",
  "addDiscount",
  "endDiscount",
  "updatePlan",
  "updateSettings",
  "inviteUser",
  "setRole",
];

export interface MutationGuardInput {
  /** Every mutation field in the schema. */
  readonly schemaMutations: readonly string[];
  /** Every mutation that has a resolver. */
  readonly resolverMutations: readonly string[];
  readonly policy: Readonly<Record<string, MutationPolicy | undefined>>;
  readonly pending: readonly string[];
}

function isHeldByARole(permission: string): boolean {
  return ROLES.some((role) => hasPermission([role], permission));
}

function policyProblems(name: string, policy: MutationPolicy): string[] {
  const problems: string[] = [];
  if (!isHeldByARole(policy.permission)) {
    problems.push(`${name}: permission "${policy.permission}" is held by no role`);
  }
  if (policy.auditAction.trim() === "") {
    problems.push(`${name}: no audit action declared`);
  }
  return problems;
}

/**
 * Compares the schema, the resolvers and the declared policy. Returns one message per problem,
 * so an empty list means every mutation is guarded and audited (or not implemented yet).
 */
export function checkMutationGuards(input: MutationGuardInput): string[] {
  const inSchema = new Set(input.schemaMutations);
  const policyNames = Object.keys(input.policy).filter((name) => input.policy[name] !== undefined);
  const pending = new Set(input.pending);
  const problems: string[] = [];

  for (const name of input.schemaMutations) {
    const declared = policyNames.includes(name);
    if (declared && pending.has(name)) {
      problems.push(`${name}: listed as pending and also has a policy`);
    } else if (!declared && !pending.has(name)) {
      problems.push(`${name}: no permission guard or audit event declared`);
    }
  }
  for (const name of [...policyNames, ...pending]) {
    if (!inSchema.has(name)) problems.push(`${name}: declared but not a mutation in the schema`);
  }
  for (const name of input.resolverMutations) {
    if (!policyNames.includes(name)) {
      problems.push(`${name}: has a resolver but no entry in MUTATION_POLICY`);
    }
  }
  for (const name of policyNames) {
    const policy = input.policy[name];
    if (policy !== undefined) problems.push(...policyProblems(name, policy));
  }
  return problems;
}
