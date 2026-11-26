import type { ErrorCode, Gym, Me, Tenant, UserError } from "@gym/graphql-schema";
import { GraphQLError } from "graphql";
import type { TenantView } from "../app/tenant-settings";
import type { Me as MeRecord } from "../app/who-am-i";
import type { DomainError, DomainErrorKind } from "../domain/errors";
import type { GymSummary } from "../domain/gym-picker";
import type { Role } from "../domain/permissions";
import { ERROR_CODE_BY_KIND } from "./errors";

type GqlRole = Gym["roles"][number];

export function toGqlRole(role: Role): GqlRole {
  return role.toUpperCase() as GqlRole;
}

export function toGqlGym(gym: GymSummary): Gym {
  return {
    tenantId: gym.tenantId,
    name: gym.name,
    logoUrl: gym.logoUrl,
    roles: gym.roles.map(toGqlRole),
  };
}

export function toGqlMe(me: MeRecord): Me {
  return {
    userId: me.userId,
    name: me.name,
    email: me.email,
    roles: me.roles.map(toGqlRole),
    permissions: [...me.permissions],
    memberId: me.memberId,
  };
}

/**
 * A member sees the name, the colour and the contacts of the gym only, so the fields of the full
 * profile are left out of what they get. A member who selects one of those fields gets a GraphQL
 * error for that field, which is the intended refusal.
 */
export function toGqlTenant(view: TenantView): Tenant {
  return view.tenant as unknown as Tenant;
}

const USER_ERROR_CODE: Readonly<Record<DomainErrorKind, ErrorCode>> = {
  validation: "INVALID_INPUT",
  unauthenticated: "FORBIDDEN",
  forbidden: "FORBIDDEN",
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
};

/** A domain error as the `errors` list of a mutation payload. */
export function toUserErrors(error: DomainError): UserError[] {
  const issues = error.kind === "validation" ? error.issues : [];
  const code = USER_ERROR_CODE[error.kind];
  if (issues.length === 0) return [{ code, field: null, message: error.message }];
  return issues.map((issue) => ({
    code,
    field: issue.path.join(".") || null,
    message: issue.message,
  }));
}

/** A domain error thrown out of a query, with the same codes the error mapper uses. */
export function toGraphQLError(error: DomainError): GraphQLError {
  return new GraphQLError(error.message, {
    extensions: { code: ERROR_CODE_BY_KIND[error.kind] },
  });
}
