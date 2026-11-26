import type { WithTenantTx } from "../../app/ports";
import type { RunInTransaction } from "../google/accounts-sql";
import { makeDataSource } from "./data-source";
import { makeWithTenantTx, type TenantTx } from "./tenant-tx";
import { rowsOf } from "./tx-executor";

/** What the server needs from the database: a probe, a clean close and the two ways to run SQL. */
export interface Database {
  ping(): Promise<void>;
  close(): Promise<void>;
  /** One plain transaction, for the tables that are not scoped to a gym: sign in and sessions. */
  transact: RunInTransaction;
  /** One transaction scoped to a gym, with row level security set to it. */
  withTenantTx: WithTenantTx<TenantTx>;
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
    transact: (fn) =>
      source.transaction((manager) =>
        fn({
          query: async (sql, params) => rowsOf(await manager.query(sql, params)),
        }),
      ),
    withTenantTx: makeWithTenantTx(source),
  };
}
