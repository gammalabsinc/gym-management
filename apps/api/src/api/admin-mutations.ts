import type {
  DiscountPayload,
  PlanPayload,
  Resolvers,
  ScanPayload,
  StaffPayload,
  TenantPayload,
} from "@gym/graphql-schema";
import type { makeAddManualDiscount, makeEndDiscount } from "../app/manual-discounts";
import type { makeRecordScan } from "../app/record-scan";
import type { makeInviteUser, makeRemoveAccess, makeSetRole } from "../app/role-management";
import type { makeUpdatePlan, makeUpdateSettings } from "../app/tenant-settings";
import type { DomainError } from "../domain/errors";
import type { GraphQLContext } from "./context";
import { parseInput } from "./input";
import {
  toGqlAddedDiscount,
  toGqlEndedDiscount,
  toGqlPlan,
  toGqlScan,
  toGqlStaff,
  toGqlTenant,
  toUserErrors,
} from "./mappers";
import { mutationArgs } from "./mutation-inputs";
import { requireGym } from "./session-guard";

/** The use cases the discount, settings, staff and scan mutations call. */
export interface AdminMutationDeps {
  readonly addDiscount: ReturnType<typeof makeAddManualDiscount>;
  readonly endDiscount: ReturnType<typeof makeEndDiscount>;
  readonly updatePlan: ReturnType<typeof makeUpdatePlan>;
  readonly updateSettings: ReturnType<typeof makeUpdateSettings>;
  readonly inviteUser: ReturnType<typeof makeInviteUser>;
  readonly setRole: ReturnType<typeof makeSetRole>;
  readonly removeAccess: ReturnType<typeof makeRemoveAccess>;
  readonly recordScan: ReturnType<typeof makeRecordScan>;
}

const NO_MEMBER_FOR_CODE = "No member has this code";

function errorsOf(error: DomainError) {
  return { errors: toUserErrors(error) };
}

export function makeAdminMutations(
  deps: AdminMutationDeps,
): NonNullable<Resolvers<GraphQLContext>["Mutation"]> {
  return {
    addDiscount: async (_parent, args, ctx): Promise<DiscountPayload> => {
      const caller = requireGym(ctx);
      const parsed = parseInput(mutationArgs.addDiscount, args);
      if (!parsed.ok) return { discount: null, ...errorsOf(parsed.error) };
      const { input } = parsed.value;
      const added = await deps.addDiscount(
        {
          memberId: input.memberId,
          amount: input.amount,
          isRecurring: input.isRecurring,
          reason: input.reason,
        },
        caller,
      );
      if (!added.ok) return { discount: null, ...errorsOf(added.error) };
      return { discount: toGqlAddedDiscount(added.value), errors: [] };
    },

    endDiscount: async (_parent, args, ctx): Promise<DiscountPayload> => {
      const caller = requireGym(ctx);
      const parsed = parseInput(mutationArgs.endDiscount, args);
      if (!parsed.ok) return { discount: null, ...errorsOf(parsed.error) };
      const { id, reason } = parsed.value;
      const ended = await deps.endDiscount({ discountId: id, reason }, caller);
      if (!ended.ok) return { discount: null, ...errorsOf(ended.error) };
      return { discount: toGqlEndedDiscount(ended.value), errors: [] };
    },

    updatePlan: async (_parent, args, ctx): Promise<PlanPayload> => {
      const caller = requireGym(ctx);
      const parsed = parseInput(mutationArgs.updatePlan, args);
      if (!parsed.ok) return { plan: null, ...errorsOf(parsed.error) };
      const { id, input } = parsed.value;
      const updated = await deps.updatePlan({ planId: id, ...input }, caller);
      if (!updated.ok) return { plan: null, ...errorsOf(updated.error) };
      return { plan: toGqlPlan(updated.value), errors: [] };
    },

    updateSettings: async (_parent, args, ctx): Promise<TenantPayload> => {
      const caller = requireGym(ctx);
      const parsed = parseInput(mutationArgs.updateSettings, args);
      if (!parsed.ok) return { tenant: null, ...errorsOf(parsed.error) };
      const updated = await deps.updateSettings(parsed.value.input, caller);
      if (!updated.ok) return { tenant: null, ...errorsOf(updated.error) };
      return { tenant: toGqlTenant({ kind: "full", tenant: updated.value }), errors: [] };
    },

    inviteUser: async (_parent, args, ctx): Promise<StaffPayload> => {
      const caller = requireGym(ctx);
      const parsed = parseInput(mutationArgs.inviteUser, args);
      if (!parsed.ok) return { user: null, ...errorsOf(parsed.error) };
      const { email, name, role } = parsed.value;
      const invited = await deps.inviteUser({ email, name, role: role.toLowerCase() }, caller);
      if (!invited.ok) return { user: null, ...errorsOf(invited.error) };
      return { user: toGqlStaff(invited.value), errors: [] };
    },

    setRole: async (_parent, args, ctx): Promise<StaffPayload> => {
      const caller = requireGym(ctx);
      const parsed = parseInput(mutationArgs.setRole, args);
      if (!parsed.ok) return { user: null, ...errorsOf(parsed.error) };
      const { userId, role, isOn } = parsed.value;
      const changed = await deps.setRole({ userId, role: role.toLowerCase(), isOn }, caller);
      if (!changed.ok) return { user: null, ...errorsOf(changed.error) };
      return { user: toGqlStaff(changed.value), errors: [] };
    },

    removeAccess: async (_parent, args, ctx): Promise<StaffPayload> => {
      const caller = requireGym(ctx);
      const parsed = parseInput(mutationArgs.removeAccess, args);
      if (!parsed.ok) return { user: null, ...errorsOf(parsed.error) };
      const removed = await deps.removeAccess({ userId: parsed.value.userId }, caller);
      if (!removed.ok) return { user: null, ...errorsOf(removed.error) };
      return { user: toGqlStaff(removed.value), errors: [] };
    },

    recordScan: async (_parent, args, ctx): Promise<ScanPayload> => {
      const caller = requireGym(ctx);
      const parsed = parseInput(mutationArgs.recordScan, args);
      if (!parsed.ok) return { visit: null, member: null, ...errorsOf(parsed.error) };
      const scanned = await deps.recordScan(
        { barcode: parsed.value.barcode, source: parsed.value.source.toLowerCase() },
        caller,
      );
      if (!scanned.ok) return { visit: null, member: null, ...errorsOf(scanned.error) };
      if (!scanned.value.found) {
        return {
          visit: null,
          member: null,
          errors: [{ code: "NOT_FOUND", field: "barcode", message: NO_MEMBER_FOR_CODE }],
        };
      }
      return { ...toGqlScan(scanned.value), errors: [] };
    },
  };
}
