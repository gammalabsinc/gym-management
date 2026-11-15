export const MIGRATOR_ROLE = "gym_migrator";
export const APP_ROLE = "gym_app";

/** The slice of a pg Client that provisioning needs. */
export interface ProvisionClient {
  query(text: string): Promise<unknown>;
  escapeLiteral(value: string): string;
}

export interface RolePasswords {
  readonly migratorPassword: string;
  readonly appPassword: string;
}

const NO_POWERS = "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS";

function createRoleIfMissing(role: string): string {
  return `DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
    CREATE ROLE ${role} ${NO_POWERS};
  END IF;
EXCEPTION WHEN unique_violation THEN
  -- Another session created the role between the check and the create, which is the goal.
  NULL;
END $$`;
}

/**
 * Builds the statements an administrator runs once per database. Safe to run again.
 * The migrator owns the schema. The app role can connect and use it, and nothing more,
 * so it can read and write rows (default privileges are set by the first migration)
 * but has no DDL rights and cannot bypass row level security.
 */
export function provisionStatements(
  passwords: RolePasswords,
  escapeLiteral: (value: string) => string,
): string[] {
  return [
    createRoleIfMissing(MIGRATOR_ROLE),
    createRoleIfMissing(APP_ROLE),
    `ALTER ROLE ${MIGRATOR_ROLE} ${NO_POWERS} PASSWORD ${escapeLiteral(passwords.migratorPassword)}`,
    `ALTER ROLE ${APP_ROLE} ${NO_POWERS} PASSWORD ${escapeLiteral(passwords.appPassword)}`,
    `DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO ${APP_ROLE}, ${MIGRATOR_ROLE}', current_database());
END $$`,
    `ALTER SCHEMA public OWNER TO ${MIGRATOR_ROLE}`,
    "REVOKE ALL ON SCHEMA public FROM PUBLIC",
    `GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`,
    // The no overlap constraint on membership_periods needs it, and only an administrator can create it.
    "CREATE EXTENSION IF NOT EXISTS btree_gist",
  ];
}

export async function provisionRoles(
  client: ProvisionClient,
  passwords: RolePasswords,
): Promise<void> {
  for (const statement of provisionStatements(passwords, (value) => client.escapeLiteral(value))) {
    await client.query(statement);
  }
}
