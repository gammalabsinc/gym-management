import { makeDataSource } from "./data-source";

/** Runs every pending migration forward, each in its own transaction. Returns the names it ran. */
export async function migrateDatabase(migratorDatabaseUrl: string): Promise<readonly string[]> {
  const dataSource = makeDataSource(migratorDatabaseUrl);
  await dataSource.initialize();
  try {
    const ran = await dataSource.runMigrations({ transaction: "each" });
    return ran.map((migration) => migration.name);
  } finally {
    await dataSource.destroy();
  }
}
