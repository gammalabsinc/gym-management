/** The roles a user can hold in one gym. They match the values the user_roles table allows. */
export const ROLES = ["owner", "staff", "member"] as const;
export type Role = (typeof ROLES)[number];

/**
 * The one table that maps a role to the permission strings it holds. Everything else reads from
 * here, so adding a permission, or giving an owner permission to staff, is an edit to this table
 * and nothing else. A permission that no role lists is held by nobody.
 */
export const ROLE_PERMISSIONS = {
  owner: [
    "member.create",
    "member.cancel",
    "payment.record",
    "scan.record",
    "plan.manage",
    "discount.manage",
    "settings.manage",
    "role.manage",
  ],
  staff: ["member.create", "payment.record", "scan.record"],
  member: [],
} as const satisfies Readonly<Record<Role, readonly string[]>>;

export type Permission = (typeof ROLE_PERMISSIONS)[Role][number];

const PERMISSIONS_BY_ROLE: Readonly<Record<Role, readonly string[]>> = ROLE_PERMISSIONS;

/** The permissions one role holds. */
export function permissionsOf(role: Role): readonly string[] {
  return PERMISSIONS_BY_ROLE[role];
}

/** True when any of the roles holds the permission. No roles, or an unlisted permission, is false. */
export function hasPermission(roles: readonly Role[], permission: string): boolean {
  return roles.some((role) => permissionsOf(role).includes(permission));
}
