import pg from "pg";
import { provisionRoles, type RolePasswords } from "./roles";

/**
 * Creates the migrator and app roles on the database in the url and sets their passwords.
 * The url must belong to an administrator. Safe to run again, a rerun rotates the passwords.
 */
export async function provisionDatabase(
  adminDatabaseUrl: string,
  passwords: RolePasswords,
): Promise<void> {
  const client = new pg.Client({ connectionString: adminDatabaseUrl });
  await client.connect();
  try {
    await provisionRoles(client, passwords);
  } finally {
    await client.end();
  }
}
