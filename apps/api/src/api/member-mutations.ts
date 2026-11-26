import type {
  InvoicePayload,
  Member,
  MemberPayload,
  PaymentPayload,
  Resolvers,
  UserError,
} from "@gym/graphql-schema";
import type { makeCancelMember, makePauseMember, makeResumeMember } from "../app/change-membership";
import type { makeCreateMember } from "../app/create-member";
import type { makeEditMember } from "../app/edit-member";
import type { makeGetMember } from "../app/member-queries";
import type { makeRecordPayment } from "../app/record-payment";
import type { makeVoidInvoice, makeVoidPayment } from "../app/voids";
import type { DomainError } from "../domain/errors";
import { validationError } from "../domain/errors";
import { DEFAULT_PLAN_KEY } from "../domain/plans";
import type { Result } from "../domain/result";
import type { GraphQLContext } from "./context";
import { parseInput } from "./input";
import {
  toGqlMember,
  toGqlRecordedPayment,
  toGqlVoidedInvoice,
  toGqlVoidedPayment,
  toUserErrors,
} from "./mappers";
import { mutationArgs } from "./mutation-inputs";
import { requireGym } from "./session-guard";

/** The use cases the member and payment mutations call. */
export interface MemberMutationDeps {
  readonly listPlans: (
    input: undefined,
    ctx: { readonly tenantId: string; readonly requestId: string },
  ) => Promise<Result<readonly { id: string; key: string; isActive: boolean }[], never>>;
  readonly getMember: ReturnType<typeof makeGetMember>;
  readonly createMember: ReturnType<typeof makeCreateMember>;
  readonly editMember: ReturnType<typeof makeEditMember>;
  readonly pauseMember: ReturnType<typeof makePauseMember>;
  readonly resumeMember: ReturnType<typeof makeResumeMember>;
  readonly cancelMember: ReturnType<typeof makeCancelMember>;
  readonly recordPayment: ReturnType<typeof makeRecordPayment>;
  readonly voidPayment: ReturnType<typeof makeVoidPayment>;
  readonly voidInvoice: ReturnType<typeof makeVoidInvoice>;
}

/** The domain names its fields its own way. The schema's input names are what the app shows. */
const MEMBER_FIELDS = { fullName: "name", joinDate: "joinedOn", referredBy: "referredById" };

type Gym = ReturnType<typeof requireGym>;

function failed(
  error: DomainError,
  rename?: Readonly<Record<string, string>>,
): { errors: UserError[] } {
  return { errors: toUserErrors(error, rename) };
}

/** The member as staff read it, after a change, so the payload shows what is stored now. */
async function reload(
  deps: MemberMutationDeps,
  caller: Gym,
  memberId: string,
): Promise<Member | null> {
  const member = await deps.getMember({ memberId }, caller);
  return member.ok ? toGqlMember(member.value) : null;
}

/** Only the default plan can be joined today, so any other plan id is refused with the field named. */
async function checkPlan(deps: MemberMutationDeps, caller: Gym, planId: string) {
  const plans = await deps.listPlans(undefined, caller);
  const plan = plans.ok ? plans.value.find((candidate) => candidate.id === planId) : undefined;
  if (plan !== undefined && plan.key === DEFAULT_PLAN_KEY && plan.isActive) return null;
  return validationError("Invalid member", [
    { path: ["planId"], message: "Not a plan you can join" },
  ]).error;
}

export function makeMemberMutations(
  deps: MemberMutationDeps,
): NonNullable<Resolvers<GraphQLContext>["Mutation"]> {
  return {
    createMember: async (_parent, args, ctx): Promise<MemberPayload> => {
      const caller = requireGym(ctx);
      const parsed = parseInput(mutationArgs.createMember, args);
      if (!parsed.ok) return { member: null, ...failed(parsed.error) };
      const { input } = parsed.value;
      if (input.photoRef !== undefined) {
        const error = validationError("Invalid member", [
          { path: ["photoRef"], message: "A photo can be added after the member is created" },
        ]).error;
        return { member: null, ...failed(error) };
      }
      const planProblem = await checkPlan(deps, caller, input.planId);
      if (planProblem !== null) return { member: null, ...failed(planProblem) };
      const created = await deps.createMember(
        {
          fullName: input.name,
          email: input.email,
          phone: input.phone,
          joinDate: input.joinedOn,
          referredBy: input.referredById,
        },
        caller,
      );
      if (!created.ok) return { member: null, ...failed(created.error, MEMBER_FIELDS) };
      return { member: await reload(deps, caller, created.value.memberId), errors: [] };
    },

    updateMember: async (_parent, args, ctx): Promise<MemberPayload> => {
      const caller = requireGym(ctx);
      const parsed = parseInput(mutationArgs.updateMember, args);
      if (!parsed.ok) return { member: null, ...failed(parsed.error) };
      const { id, patch } = parsed.value;
      const { status, reason, ...profile } = patch;
      const hasProfile = Object.values(profile).some((value) => value !== undefined);
      if (!hasProfile && status === undefined) {
        const error = validationError("Nothing to change", [
          { path: [], message: "Send a field to change" },
        ]).error;
        return { member: null, ...failed(error) };
      }
      if (status !== undefined && (reason === undefined || reason.trim() === "")) {
        const error = validationError("A reason is required", [
          { path: ["reason"], message: "A reason is required" },
        ]).error;
        return { member: null, ...failed(error) };
      }
      if (hasProfile) {
        const fields = Object.fromEntries(
          Object.entries(profile).filter(([, value]) => value !== undefined),
        );
        const edited = await deps.editMember({ memberId: id, fields }, caller);
        if (!edited.ok) return { member: null, ...failed(edited.error) };
      }
      if (status !== undefined) {
        const change = { memberId: id, reason: reason ?? "" };
        const run =
          status === "PAUSED"
            ? deps.pauseMember
            : status === "CANCELLED"
              ? deps.cancelMember
              : deps.resumeMember;
        const changed = await run(change, caller);
        if (!changed.ok) return { member: null, ...failed(changed.error) };
      }
      return { member: await reload(deps, caller, id), errors: [] };
    },

    recordPayment: async (_parent, args, ctx): Promise<PaymentPayload> => {
      const caller = requireGym(ctx);
      const parsed = parseInput(mutationArgs.recordPayment, args);
      if (!parsed.ok) return { payment: null, member: null, ...failed(parsed.error) };
      const { input } = parsed.value;
      const recorded = await deps.recordPayment(
        {
          clientRequestId: input.clientRequestId,
          memberId: input.memberId,
          amount: input.amount,
          method: input.method.toLowerCase(),
          paidOn: input.paidOn,
          proofLink: input.proofLink,
        },
        caller,
      );
      if (!recorded.ok) return { payment: null, member: null, ...failed(recorded.error) };
      return {
        payment: toGqlRecordedPayment(recorded.value),
        member: await reload(deps, caller, recorded.value.memberId),
        errors: [],
      };
    },

    voidPayment: async (_parent, args, ctx): Promise<PaymentPayload> => {
      const caller = requireGym(ctx);
      const parsed = parseInput(mutationArgs.voidPayment, args);
      if (!parsed.ok) return { payment: null, member: null, ...failed(parsed.error) };
      const { id, reason } = parsed.value;
      const voided = await deps.voidPayment({ paymentId: id, reason }, caller);
      if (!voided.ok) return { payment: null, member: null, ...failed(voided.error) };
      return {
        payment: toGqlVoidedPayment(voided.value),
        member: await reload(deps, caller, voided.value.memberId),
        errors: [],
      };
    },

    voidInvoice: async (_parent, args, ctx): Promise<InvoicePayload> => {
      const caller = requireGym(ctx);
      const parsed = parseInput(mutationArgs.voidInvoice, args);
      if (!parsed.ok) return { invoice: null, ...failed(parsed.error) };
      const { id, reason } = parsed.value;
      const voided = await deps.voidInvoice({ invoiceId: id, reason }, caller);
      if (!voided.ok) return { invoice: null, ...failed(voided.error) };
      return { invoice: toGqlVoidedInvoice(voided.value), errors: [] };
    },
  };
}
