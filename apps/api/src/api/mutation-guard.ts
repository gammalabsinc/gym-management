import type { Mutation } from "@gym/graphql-schema";
import { MEMBER_CREATED } from "../app/create-member";
import { MEMBER_UPDATED } from "../app/edit-member";
import { DISCOUNT_ADDED, DISCOUNT_ENDED } from "../app/manual-discounts";
import { PAYMENT_RECORDED } from "../app/record-payment";
import { ROLE_ASSIGNED, ROLE_REVOKED } from "../app/role-management";
import { PLAN_UPDATED, SETTINGS_UPDATED } from "../app/tenant-settings";
import { INVOICE_VOIDED, PAYMENT_VOIDED } from "../app/voids";
import { hasPermission, type Permission, ROLES } from "../domain/permissions";

export type MutationName = Exclude<keyof Mutation, "__typename">;

/** What a mutation declares: the permission that guards it and the audit event it writes. */
export interface MutationPolicy {
  readonly permission: Permission;
  readonly auditAction: string;
  /**
   * Set only when the change is its own record and writes no audit event, with the reason. A
   * check in is the attendance row itself, so a second record of it would say the same thing.
   */
  readonly auditExemption?: string;
}

/**
 * The policy of every mutation that is implemented. The ticket that implements a mutation adds
 * its entry here, in the same change as the resolver. A resolver without an entry fails the
 * guard test, so a mutation cannot ship unguarded or unaudited.
 */
export const MUTATION_POLICY: Readonly<Partial<Record<MutationName, MutationPolicy>>> = {
  createMember: { permission: "member.create", auditAction: MEMBER_CREATED },
  // The profile edit needs member.update. A status change needs member.pause, or member.cancel
  // for a cancel, and the use cases check those themselves before they write.
  updateMember: { permission: "member.update", auditAction: MEMBER_UPDATED },
  recordPayment: { permission: "payment.record", auditAction: PAYMENT_RECORDED },
  voidPayment: { permission: "payment.void", auditAction: PAYMENT_VOIDED },
  voidInvoice: { permission: "invoice.void", auditAction: INVOICE_VOIDED },
  addDiscount: { permission: "discount.manage", auditAction: DISCOUNT_ADDED },
  endDiscount: { permission: "discount.manage", auditAction: DISCOUNT_ENDED },
  updatePlan: { permission: "settings.manage", auditAction: PLAN_UPDATED },
  updateSettings: { permission: "settings.manage", auditAction: SETTINGS_UPDATED },
  inviteUser: { permission: "role.manage", auditAction: ROLE_ASSIGNED },
  setRole: { permission: "role.manage", auditAction: ROLE_ASSIGNED },
  removeAccess: { permission: "role.manage", auditAction: ROLE_REVOKED },
  recordScan: {
    permission: "scan.record",
    auditAction: "",
    auditExemption: "The attendance row is the record of the check in",
  },
};

/**
 * Mutations that belong to the person and not to a gym role: they sign in, sign out and pick a
 * gym. They run before a gym is chosen, so no role permission can guard them. Each one checks
 * the session itself, and none of them writes a gym audit event, because they change no gym data.
 */
export const IDENTITY_MUTATIONS: readonly MutationName[] = ["signIn", "signOut", "selectGym"];

/**
 * Mutations that are in schema.graphql but not implemented yet. The ticket that implements one
 * moves it from this list to MUTATION_POLICY. Adding a name here to get past the guard test is
 * visible in review, and the test still fails for a name that is in neither place.
 */
export const PENDING_MUTATIONS: readonly MutationName[] = [];

export interface MutationGuardInput {
  /** Every mutation field in the schema. */
  readonly schemaMutations: readonly string[];
  /** Every mutation that has a resolver. */
  readonly resolverMutations: readonly string[];
  readonly policy: Readonly<Record<string, MutationPolicy | undefined>>;
  readonly pending: readonly string[];
  /** Mutations of the person, not of a gym role. They need no permission and no audit event. */
  readonly identity?: readonly string[];
}

function isHeldByARole(permission: string): boolean {
  return ROLES.some((role) => hasPermission([role], permission));
}

function policyProblems(name: string, policy: MutationPolicy): string[] {
  const problems: string[] = [];
  if (!isHeldByARole(policy.permission)) {
    problems.push(`${name}: permission "${policy.permission}" is held by no role`);
  }
  const exempt = (policy.auditExemption ?? "").trim() !== "";
  if (policy.auditAction.trim() === "" && !exempt) {
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
  const identity = new Set(input.identity ?? []);
  const problems: string[] = [];

  for (const name of input.schemaMutations) {
    const declared = policyNames.includes(name);
    const isIdentity = identity.has(name);
    if ((declared || isIdentity) && pending.has(name)) {
      problems.push(`${name}: listed as pending and also has a policy`);
    } else if (declared && isIdentity) {
      problems.push(`${name}: is an identity mutation and also has a role policy`);
    } else if (!declared && !isIdentity && !pending.has(name)) {
      problems.push(`${name}: no permission guard or audit event declared`);
    }
  }
  for (const name of [...policyNames, ...pending, ...identity]) {
    if (!inSchema.has(name)) problems.push(`${name}: declared but not a mutation in the schema`);
  }
  for (const name of input.resolverMutations) {
    if (!policyNames.includes(name) && !identity.has(name)) {
      problems.push(`${name}: has a resolver but no entry in MUTATION_POLICY`);
    }
  }
  for (const name of policyNames) {
    const policy = input.policy[name];
    if (policy !== undefined) problems.push(...policyProblems(name, policy));
  }
  return problems;
}
