import { GrantAppPrivileges1700000000000 } from "./1700000000000-grant-app-privileges";
import { TenancyTables1700000001000 } from "./1700000001000-tenancy-tables";

/** Listed in run order. Classes, not a glob, so the bundled server finds them. */
export const MIGRATIONS = [GrantAppPrivileges1700000000000, TenancyTables1700000001000];
