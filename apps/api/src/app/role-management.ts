import { hasSignedIn } from "../domain/account";
import {
  type ConflictError,
  conflict,
  type NotFoundError,
  notFound,
  type ValidationError,
  validationError,
} from "../domain/errors";
import type { Role } from "../domain/permissions";
import { err, ok, type Result } from "../domain/result";
import {
  hasStaffAccess,
  type InviteInput,
  isStaffRole,
  parseInvite,
  parseUserId,
  type StaffRole,
  wouldRemoveLastOwner,
} from "../domain/staff";
import type { Clock, StaffRecord, StaffUnit, WithTenantTx } from "./ports";
import { type PermissionContext, requirePermission } from "./require-permission";

export const ROLE_ASSIGNED = "role.assigned";
export const ROLE_REVOKED = "role.revoked";

export interface RoleManagementDeps {
  readonly withUnit: WithTenantTx<StaffUnit>;
  readonly clock: Clock;
}

/** The tenant, the caller and the request all come from the session, never from client input. */
export interface RoleManagementContext extends PermissionContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly requestId: string;
}

/** A row of the staff list. `hasSignedIn` drives the Invited chip. */
export interface StaffMember {
  readonly userId: string;
  readonly name: string | null;
  readonly email: string;
  readonly roles: readonly Role[];
  readonly hasSignedIn: boolean;
}

export interface SetRoleInput {
  readonly userId: string;
  readonly role: string;
  readonly isOn: boolean;
}

export interface RemoveAccessInput {
  readonly userId: string;
}

type RoleError = ValidationError | NotFoundError | ConflictError;

const LAST_OWNER_MESSAGE = "A gym must keep at least one owner";

function toMember(record: StaffRecord): StaffMember {
  return {
    userId: record.userId,
    name: record.name,
    email: record.email,
    roles: record.roles,
    hasSignedIn: hasSignedIn(record),
  };
}

function withRoles(record: StaffRecord, roles: readonly Role[]): StaffRecord {
  return { ...record, roles: [...roles].sort() };
}

function snapshot(record: StaffRecord) {
  return { email: record.email, name: record.name, roles: [...record.roles] };
}

function recordChange(
  unit: StaffUnit,
  ctx: RoleManagementContext,
  action: string,
  before: StaffRecord | null,
  after: StaffRecord,
): Promise<void> {
  return unit.audit.record({
    actorUserId: ctx.userId,
    action,
    entityType: "user",
    entityId: after.userId,
    before: before === null ? null : snapshot(before),
    after: snapshot(after),
    requestId: ctx.requestId,
  });
}

/** Grants one role. Granting a role the user already holds changes nothing and writes no event. */
async function grant(
  unit: StaffUnit,
  ctx: RoleManagementContext,
  user: StaffRecord,
  role: StaffRole,
): Promise<StaffRecord> {
  if (user.roles.includes(role)) return user;
  const added = await unit.staff.addRole(user.userId, role);
  if (!added) return user;
  const after = withRoles(user, [...user.roles, role]);
  await recordChange(unit, ctx, ROLE_ASSIGNED, user, after);
  return after;
}

/**
 * Takes the given roles from a user, one audit event per role. An owner can only be removed while
 * another owner is left. A person who ends up with no staff side role loses their sessions at
 * once, so the access ends now and not when the session would have expired.
 */
async function revoke(
  deps: RoleManagementDeps,
  unit: StaffUnit,
  ctx: RoleManagementContext,
  userId: string,
  roles: readonly StaffRole[],
): Promise<Result<StaffRecord, NotFoundError | ConflictError>> {
  const owners = await unit.staff.lockOwners();
  const user = await unit.staff.find(userId);
  if (user === null) return notFound("User not found");
  const held = roles.filter((role) => user.roles.includes(role));
  if (held.includes("owner") && wouldRemoveLastOwner(owners, userId)) {
    return conflict(LAST_OWNER_MESSAGE);
  }
  let current = user;
  for (const role of held) {
    if (!(await unit.staff.removeRole(userId, role))) continue;
    const next = withRoles(
      current,
      current.roles.filter((held) => held !== role),
    );
    await recordChange(unit, ctx, ROLE_REVOKED, current, next);
    current = next;
  }
  if (current !== user && !hasStaffAccess(current.roles) && current.authSubject !== null) {
    await unit.sessions.revokeAllForSubject(current.authSubject, deps.clock.now());
  }
  return ok(current);
}

/** The owners and staff of the gym, for the Staff screen. */
export function makeListStaff(deps: RoleManagementDeps) {
  return requirePermission<void, RoleManagementContext, readonly StaffMember[], never>(
    "role.manage",
    async (_input, ctx) =>
      ok(
        await deps.withUnit(ctx.tenantId, async (unit) => (await unit.staff.list()).map(toMember)),
      ),
  );
}

/**
 * Adds someone by Google email and gives them a role. No email is sent: the person is Invited
 * until they sign in with that address. An email that already has a row in this gym keeps the
 * row, and only gains the role.
 */
export function makeInviteUser(deps: RoleManagementDeps) {
  return requirePermission<InviteInput, RoleManagementContext, StaffMember, RoleError>(
    "role.manage",
    async (input, ctx) => {
      const parsed = parseInvite(input);
      if (!parsed.ok) return parsed;
      const { email, name, role } = parsed.value;
      return deps.withUnit(ctx.tenantId, async (unit): Promise<Result<StaffMember, RoleError>> => {
        const existing = await unit.staff.findByEmail(email);
        if (existing !== null) return ok(toMember(await grant(unit, ctx, existing, role)));
        const userId = await unit.staff.createUser({ email, name });
        if (userId === null) return conflict("This email was just added, try again");
        await unit.staff.addRole(userId, role);
        const created: StaffRecord = { userId, name, email, roles: [role], authSubject: null };
        await recordChange(unit, ctx, ROLE_ASSIGNED, null, created);
        return ok(toMember(created));
      });
    },
  );
}

/** Turns the owner or staff role on or off for one user. */
export function makeSetRole(deps: RoleManagementDeps) {
  return requirePermission<SetRoleInput, RoleManagementContext, StaffMember, RoleError>(
    "role.manage",
    async (input, ctx) => {
      const id = parseUserId(input.userId);
      if (!id.ok) return id;
      if (!isStaffRole(input.role)) {
        return validationError("Invalid role", [
          { path: ["role"], message: "Only owner and staff roles are managed here" },
        ]);
      }
      const role = input.role;
      return deps.withUnit(ctx.tenantId, async (unit): Promise<Result<StaffMember, RoleError>> => {
        if (!input.isOn) {
          const revoked = await revoke(deps, unit, ctx, id.value, [role]);
          return revoked.ok ? ok(toMember(revoked.value)) : revoked;
        }
        const user = await unit.staff.find(id.value);
        if (user === null) return notFound("User not found");
        return ok(toMember(await grant(unit, ctx, user, role)));
      });
    },
  );
}

/** Takes away every staff side role of a user, and ends their sessions. */
export function makeRemoveAccess(deps: RoleManagementDeps) {
  return requirePermission<RemoveAccessInput, RoleManagementContext, StaffMember, RoleError>(
    "role.manage",
    async (input, ctx) => {
      const id = parseUserId(input.userId);
      if (!id.ok) return err(id.error);
      return deps.withUnit(ctx.tenantId, async (unit): Promise<Result<StaffMember, RoleError>> => {
        const revoked = await revoke(deps, unit, ctx, id.value, ["owner", "staff"]);
        return revoked.ok ? ok(toMember(revoked.value)) : revoked;
      });
    },
  );
}
