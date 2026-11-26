import type { Role } from "../auth/session";

export interface TabDefinition {
  readonly name: string;
  readonly title: string;
}

export const CUSTOMER_TABS: readonly TabDefinition[] = [
  { name: "Card", title: "Member card" },
  { name: "Visits", title: "Visits" },
  { name: "Profile", title: "Profile" },
];

const STAFF_TABS: readonly TabDefinition[] = [
  { name: "Scan", title: "Scan" },
  { name: "Customers", title: "Customers" },
];

/** Owners also get Settings and Staff. Hiding a tab is cosmetic, the API still enforces the permission. */
export const OWNER_TABS: readonly TabDefinition[] = [
  ...STAFF_TABS,
  { name: "Settings", title: "Settings" },
  { name: "Staff", title: "Staff" },
];

export const ADMIN_TABS = STAFF_TABS;

export function adminTabsFor(role: Role): readonly TabDefinition[] {
  return role === "owner" ? OWNER_TABS : ADMIN_TABS;
}
