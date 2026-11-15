import type { DataSource, EntityManager } from "typeorm";
import type { WithTenantTx } from "../../app/ports";

/** The Postgres setting that row level security policies read. */
export const TENANT_SETTING = "app.tenant_id";

const MAX_TENANT_ID_LENGTH = 64;

declare const issued: unique symbol;

/**
 * Proof that code is running inside `withTenantTx`. Only `withTenantTx` creates one, and it stops
 * working when the transaction ends, so a repository built from it cannot outlive the request.
 */
export interface TenantTx {
  readonly [issued]: true;
  readonly tenantId: string;
  /** Throws once the transaction has committed or rolled back. */
  readonly manager: EntityManager;
}

const live = new WeakSet<object>();

/**
 * Repository factories take a `TenantTx` and call this first. A handle that did not come from
 * `withTenantTx`, or one whose transaction has ended, is refused.
 */
export function requireTenantTx(tx: TenantTx): TenantTx {
  if (!live.has(tx)) throw new Error("Repositories can only be built inside withTenantTx");
  return tx;
}

function issue(tenantId: string, manager: EntityManager): { tx: TenantTx; end(): void } {
  const handle = {
    tenantId,
    get manager(): EntityManager {
      if (!live.has(handle)) throw new Error("The tenant transaction has ended");
      return manager;
    },
  };
  live.add(handle);
  return { tx: handle as unknown as TenantTx, end: () => live.delete(handle) };
}

/**
 * Opens a transaction, sets the tenant with a transaction local `set_config` so it is reset at
 * commit or rollback and cannot leak to the next user of a pooled connection, then runs `fn`.
 */
export function makeWithTenantTx(dataSource: DataSource): WithTenantTx<TenantTx> {
  return async (tenantId, fn) => {
    if (tenantId.trim() === "" || tenantId.length > MAX_TENANT_ID_LENGTH) {
      throw new RangeError("A tenant id is required and must be at most 64 characters");
    }
    return dataSource.transaction(async (manager) => {
      await manager.query("SELECT set_config($1, $2, true)", [TENANT_SETTING, tenantId]);
      const { tx, end } = issue(tenantId, manager);
      try {
        return await fn(tx);
      } finally {
        end();
      }
    });
  };
}
