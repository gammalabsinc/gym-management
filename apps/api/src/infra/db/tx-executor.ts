import type { SqlExecutor } from "./sql-executor";
import { requireTenantTx, type TenantTx } from "./tenant-tx";

/** TypeORM answers an UPDATE or DELETE with `[rows, affectedCount]`. Every other statement answers rows. */
export function isAffectedRowsPair(raw: unknown): raw is [unknown[], number] {
  return (
    Array.isArray(raw) && raw.length === 2 && Array.isArray(raw[0]) && typeof raw[1] === "number"
  );
}

/** The rows of a TypeORM answer, whatever the statement kind was. */
export function rowsOf(raw: unknown): unknown {
  return isAffectedRowsPair(raw) ? raw[0] : raw;
}

/**
 * Lets the SQL adapters that were written against a plain pg client run inside a tenant
 * transaction. Statements with RETURNING give back their rows, whatever the statement kind.
 */
export function makeTxExecutor(tx: TenantTx): SqlExecutor {
  const scope = requireTenantTx(tx);
  return {
    async query(sql, params) {
      return rowsOf(await scope.manager.query(sql, params));
    },
  };
}
