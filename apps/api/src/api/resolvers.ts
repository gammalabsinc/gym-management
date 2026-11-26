import type { Resolvers } from "@gym/graphql-schema";
import type { makeEnterGym } from "../app/enter-gym";
import type { makeListMyGyms } from "../app/gym-picker";
import type { SignedIn } from "../app/sign-in";
import type { makeWhoAmI } from "../app/who-am-i";
import { forbidden, type UnauthenticatedError, unauthenticated } from "../domain/errors";
import type { Result } from "../domain/result";
import type { GraphQLContext } from "./context";
import { parseInput } from "./input";
import { toGqlGym, toGqlMe, toGqlTenant, toGraphQLError, toUserErrors } from "./mappers";
import { mutationArgs } from "./mutation-inputs";

/** The use cases the resolvers call. The composition root builds them with real adapters. */
export interface ResolverDeps {
  readonly signIn: (idToken: string) => Promise<Result<SignedIn, UnauthenticatedError>>;
  readonly signOut: (token: string) => Promise<void>;
  readonly listMyGyms: ReturnType<typeof makeListMyGyms>;
  readonly enterGym: ReturnType<typeof makeEnterGym>;
  readonly whoAmI: ReturnType<typeof makeWhoAmI>;
}

function requireSession(ctx: GraphQLContext) {
  if (ctx.session === null) throw toGraphQLError(unauthenticated().error);
  return ctx.session;
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
