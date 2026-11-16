import { type ValidationError, validationError } from "./errors";
import type { Role } from "./permissions";
import { ok, type Result } from "./result";

/** The roles that role management hands out. Members are added through the member use cases. */
export const STAFF_ROLES = ["owner", "staff"] as const satisfies readonly Role[];
export type StaffRole = (typeof STAFF_ROLES)[number];

export const MAX_EMAIL_LENGTH = 254;
export const MAX_NAME_LENGTH = 120;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isStaffRole(role: string): role is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

/** True when the roles let a person into the staff side of the app. */
export function hasStaffAccess(roles: readonly Role[]): boolean {
  return roles.some(isStaffRole);
}

/** True when taking the owner role from this user would leave the gym with no owner. */
export function wouldRemoveLastOwner(ownerIds: readonly string[], userId: string): boolean {
  return ownerIds.includes(userId) && ownerIds.every((id) => id === userId);
}

export function parseUserId(raw: string): Result<string, ValidationError> {
  const id = raw.trim();
  return UUID_PATTERN.test(id)
    ? ok(id.toLowerCase())
    : validationError("Invalid user id", [{ path: ["userId"], message: "Invalid id" }]);
}

export interface InviteInput {
  readonly email: string;
  readonly name?: string | null | undefined;
  readonly role: string;
}

export interface Invite {
  readonly email: string;
  readonly name: string | null;
  readonly role: StaffRole;
}

/**
 * Checks an invitation and puts it in the form it is stored in: a lower case email, a trimmed
 * name that is null when blank, and a role that is owner or staff. Every problem is reported.
 */
export function parseInvite(input: InviteInput): Result<Invite, ValidationError> {
  const email = input.email.trim().toLowerCase();
  const name = input.name?.trim() ?? "";
  const role = input.role;
  const issues = [
    ...(email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)
      ? [{ path: ["email"], message: "Enter a valid email address" }]
      : []),
    ...(name.length > MAX_NAME_LENGTH
      ? [{ path: ["name"], message: `At most ${MAX_NAME_LENGTH} characters` }]
      : []),
    ...(isStaffRole(role) ? [] : [{ path: ["role"], message: "Choose owner or staff" }]),
  ];
  if (issues.length > 0 || !isStaffRole(role)) return validationError("Invalid invitation", issues);
  return ok({ email, name: name === "" ? null : name, role });
}
