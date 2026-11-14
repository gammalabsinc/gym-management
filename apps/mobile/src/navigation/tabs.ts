export interface TabDefinition {
  readonly name: string;
  readonly title: string;
}

export const CUSTOMER_TABS: readonly TabDefinition[] = [
  { name: "Card", title: "Member card" },
  { name: "Visits", title: "Visits" },
  { name: "Profile", title: "Profile" },
];

export const ADMIN_TABS: readonly TabDefinition[] = [
  { name: "Scan", title: "Scan" },
  { name: "Customers", title: "Customers" },
  { name: "Settings", title: "Settings" },
];
