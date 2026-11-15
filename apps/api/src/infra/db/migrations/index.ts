import { GrantAppPrivileges1700000000000 } from "./1700000000000-grant-app-privileges";
import { TenancyTables1700000001000 } from "./1700000001000-tenancy-tables";
import { AuditEvents1700000002000 } from "./1700000002000-audit-events";
import { RowLevelSecurity1700000003000 } from "./1700000003000-row-level-security";

/** Listed in run order. Classes, not a glob, so the bundled server finds them. */
export const MIGRATIONS = [
  GrantAppPrivileges1700000000000,
  TenancyTables1700000001000,
  AuditEvents1700000002000,
  RowLevelSecurity1700000003000,
];
