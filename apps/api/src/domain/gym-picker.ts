import { ROLES, type Role } from "./permissions";

/**
 * One gym as the picker shows it to one person: the public handle and the person's own roles
 * there, and nothing else about the gym. The id is the public tenant id.
 */
export interface GymSummary {
  readonly tenantId: string;
  readonly name: string;
  readonly subdomain: string;
  readonly logoUrl: string | null;
  /** Every role the person holds in this gym, in alphabetical order. At least one. */
  readonly roles: readonly Role[];
}

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** The roles of a row, in the order given, with anything that is not a known role left out. */
export function rolesFromRows(values: readonly string[]): readonly Role[] {
  return values.filter(isRole);
}

/** A stable order for the picker: by name, then by id, so two gyms of one name never swap. */
export function sortGyms(gyms: readonly GymSummary[]): readonly GymSummary[] {
  return [...gyms].sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    if (a.tenantId === b.tenantId) return 0;
    return a.tenantId < b.tenantId ? -1 : 1;
  });
}
