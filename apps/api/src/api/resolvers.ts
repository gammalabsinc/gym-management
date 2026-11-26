import type { Resolvers } from "@gym/graphql-schema";
import type { makeMemberHistory } from "../app/attendance-queries";
import type { makeEnterGym } from "../app/enter-gym";
import type { makeListMyGyms } from "../app/gym-picker";
import type {
  makeMemberDiscounts,
  makeMemberInvoices,
  makeMemberPayments,
  makeMembershipHistory,
} from "../app/member-ledger";
import type { makeGetMember, makeListMembers } from "../app/member-queries";
import type { makeGetOwnMember, makeGetOwnVisits } from "../app/member-self-service";
import type { makeListPlans } from "../app/plans";
import type { makePreviewPayment } from "../app/preview-payment";
import type { SignedIn } from "../app/sign-in";
import type { makeGetTenant } from "../app/tenant-settings";
import type { makeWhoAmI } from "../app/who-am-i";
import { forbidden, type UnauthenticatedError, unauthenticated } from "../domain/errors";
import { hasPermission } from "../domain/permissions";
import type { Result } from "../domain/result";
import type { GraphQLContext } from "./context";
import { parseInput } from "./input";
import {
  referrerIdOf,
  toGqlDiscount,
  toGqlGym,
  toGqlInvoice,
  toGqlMe,
  toGqlMember,
  toGqlMemberPage,
  toGqlPage,
  toGqlPayment,
  toGqlPeriod,
  toGqlPlan,
  toGqlPreview,
  toGqlTenant,
  toGqlVisit,
  toGraphQLError,
  toUserErrors,
} from "./mappers";
import { mutationArgs } from "./mutation-inputs";

/** The use cases the resolvers call. The composition root builds them with real adapters. */
export interface ResolverDeps {
  readonly signIn: (idToken: string) => Promise<Result<SignedIn, UnauthenticatedError>>;
  readonly signOut: (token: string) => Promise<void>;
  readonly listMyGyms: ReturnType<typeof makeListMyGyms>;
  readonly enterGym: ReturnType<typeof makeEnterGym>;
  readonly whoAmI: ReturnType<typeof makeWhoAmI>;
  readonly getTenant: ReturnType<typeof makeGetTenant>;
  readonly listPlans: ReturnType<typeof makeListPlans>;
  readonly listMembers: ReturnType<typeof makeListMembers>;
  readonly getMember: ReturnType<typeof makeGetMember>;
  readonly getOwnMember: ReturnType<typeof makeGetOwnMember>;
  readonly invoices: ReturnType<typeof makeMemberInvoices>;
  readonly payments: ReturnType<typeof makeMemberPayments>;
  readonly discounts: ReturnType<typeof makeMemberDiscounts>;
  readonly membershipPeriods: ReturnType<typeof makeMembershipHistory>;
  readonly memberVisits: ReturnType<typeof makeMemberHistory>;
  readonly ownVisits: ReturnType<typeof makeGetOwnVisits>;
  readonly previewPayment: ReturnType<typeof makePreviewPayment>;
}

function requireSession(ctx: GraphQLContext) {
  if (ctx.session === null) throw toGraphQLError(unauthenticated().error);
  return ctx.session;
}

/** The caller inside a gym. Roles, user and gym all come from the session, never from the request. */
function requireGym(ctx: GraphQLContext) {
  const session = requireSession(ctx);
  if (session.tenantId === null || session.userId === null) {
    throw toGraphQLError(forbidden("Pick a gym first").error);
  }
  return {
    tenantId: session.tenantId,
    userId: session.userId,
    roles: session.roles,
    requestId: ctx.requestId,
  };
}

function pageInput(args: {
  readonly memberId: string;
  readonly page?: { readonly limit?: number | null; readonly cursor?: string | null } | null;
}) {
  return { memberId: args.memberId, limit: args.page?.limit, cursor: args.page?.cursor };
}

/**
 * Typed against the generated resolver types, so a return type that drifts from
 * schema.graphql fails tsc. Operations are added here by the tickets that own them. Without
 * deps only the health query exists, which is what the schema level tests build on.
 */
export function makeResolvers(deps?: ResolverDeps): Resolvers<GraphQLContext> {
  if (deps === undefined) return { Query: { health: () => "ok" } };
  return {
    Query: {
      health: () => "ok",
      myGyms: async (_parent, _args, ctx) => {
        const session = requireSession(ctx);
        const gyms = await deps.listMyGyms(undefined, { subject: session.subject });
        if (!gyms.ok) throw toGraphQLError(gyms.error);
        return gyms.value.map(toGqlGym);
      },
      me: async (_parent, _args, ctx) => {
        const session = requireSession(ctx);
        if (session.tenantId === null || session.userId === null) {
          throw toGraphQLError(forbidden("Pick a gym first").error);
        }
        const me = await deps.whoAmI(undefined, {
          tenantId: session.tenantId,
          userId: session.userId,
        });
        if (!me.ok) throw toGraphQLError(me.error);
        return toGqlMe(me.value);
      },
      tenant: async (_parent, _args, ctx) => {
        const tenant = await deps.getTenant(undefined, requireGym(ctx));
        if (!tenant.ok) throw toGraphQLError(tenant.error);
        return toGqlTenant(tenant.value);
      },
      plans: async (_parent, _args, ctx) => {
        const plans = await deps.listPlans(undefined, requireGym(ctx));
        if (!plans.ok) throw toGraphQLError(plans.error);
        return plans.value.map(toGqlPlan);
      },
      members: async (_parent, args, ctx) => {
        const page = await deps.listMembers(
          { search: args.search, limit: args.page?.limit, cursor: args.page?.cursor },
          requireGym(ctx),
        );
        if (!page.ok) throw toGraphQLError(page.error);
        return toGqlMemberPage(page.value);
      },
      invoices: async (_parent, args, ctx) => {
        const page = await deps.invoices(pageInput(args), requireGym(ctx));
        if (!page.ok) throw toGraphQLError(page.error);
        return toGqlPage(page.value, (row) => toGqlInvoice(args.memberId, row));
      },
      payments: async (_parent, args, ctx) => {
        const page = await deps.payments(pageInput(args), requireGym(ctx));
        if (!page.ok) throw toGraphQLError(page.error);
        return toGqlPage(page.value, (row) => toGqlPayment(args.memberId, row));
      },
      discounts: async (_parent, args, ctx) => {
        const page = await deps.discounts({ memberId: args.memberId }, requireGym(ctx));
        if (!page.ok) throw toGraphQLError(page.error);
        return page.value.items.map((row) => toGqlDiscount(args.memberId, row));
      },
      membershipPeriods: async (_parent, args, ctx) => {
        const caller = requireGym(ctx);
        if (!hasPermission(caller.roles, "member.read")) {
          throw toGraphQLError(forbidden().error);
        }
        const page = await deps.membershipPeriods({ memberId: args.memberId }, caller);
        if (!page.ok) throw toGraphQLError(page.error);
        return page.value.items.map((row) => toGqlPeriod(args.memberId, row));
      },
      visits: async (_parent, args, ctx) => {
        const caller = requireGym(ctx);
        const input = { ...pageInput(args) };
        const page = hasPermission(caller.roles, "member.read")
          ? await deps.memberVisits(input, caller)
          : await deps.ownVisits(input, caller);
        if (!page.ok) throw toGraphQLError(page.error);
        return { items: page.value.items.map(toGqlVisit), nextCursor: page.value.nextCursor };
      },
      previewPayment: async (_parent, args, ctx) => {
        const preview = await deps.previewPayment(args, requireGym(ctx));
        if (!preview.ok) throw toGraphQLError(preview.error);
        return toGqlPreview(preview.value);
      },
      member: async (_parent, args, ctx) => {
        const caller = requireGym(ctx);
        const input = { memberId: args.id };
        const found = hasPermission(caller.roles, "member.read")
          ? await deps.getMember(input, caller)
          : await deps.getOwnMember(input, caller);
        if (!found.ok) throw toGraphQLError(found.error);
        return toGqlMember(found.value);
      },
    },
    Member: {
      referredBy: async (parent, _args, ctx) => {
        const id = referrerIdOf(parent);
        if (id === null || ctx.loaders === null) return null;
        const referrer = await ctx.loaders.member.load(id);
        return referrer === null ? null : toGqlMember(referrer);
      },
    },
    Mutation: {
      signIn: async (_parent, args) => {
        const parsed = parseInput(mutationArgs.signIn, args);
        if (!parsed.ok)
          return { token: null, expiresAt: null, gyms: [], errors: toUserErrors(parsed.error) };
        const signedIn = await deps.signIn(parsed.value.idToken);
        if (!signedIn.ok) {
          return { token: null, expiresAt: null, gyms: [], errors: toUserErrors(signedIn.error) };
        }
        const { token, expiresAt, gyms } = signedIn.value;
        return { token, expiresAt: expiresAt.toISOString(), gyms: gyms.map(toGqlGym), errors: [] };
      },
      signOut: async (_parent, _args, ctx) => {
        if (ctx.token !== null) await deps.signOut(ctx.token);
        return true;
      },
      selectGym: async (_parent, args, ctx) => {
        const session = requireSession(ctx);
        const parsed = parseInput(mutationArgs.selectGym, args);
        if (!parsed.ok) return { me: null, tenant: null, errors: toUserErrors(parsed.error) };
        const entered = await deps.enterGym(parsed.value, {
          sessionId: session.sessionId,
          subject: session.subject,
        });
        if (!entered.ok) return { me: null, tenant: null, errors: toUserErrors(entered.error) };
        return {
          me: toGqlMe(entered.value.me),
          tenant: toGqlTenant(entered.value.tenant),
          errors: [],
        };
      },
    },
  };
}
