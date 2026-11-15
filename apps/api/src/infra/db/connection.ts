import { makeDataSource } from "./data-source";

/** What the server needs from the database: a cheap liveness probe and a clean close. */
export interface Database {
  ping(): Promise<void>;
  close(): Promise<void>;
}

/** Opens the pool for the app role. Rejects when the database cannot be reached. */
export async function connectDatabase(url: string): Promise<Database> {
  const source = makeDataSource(url);
  await source.initialize();
  return {
    ping: async () => {
      await source.query("SELECT 1");
    },
    close: () => source.destroy(),
  };
}
