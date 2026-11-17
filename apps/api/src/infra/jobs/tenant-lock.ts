import type { Exclusive, TenantJobLock } from "../../app/ports";

/** The part of a pg pool the lock needs. A pg Pool fits. */
export interface LockPool {
  connect(): Promise<LockClient>;
}

export interface LockClient {
  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }>;
  release(): void;
}

/** Keeps this job's locks apart from any other use of advisory locks in the same database. */
const LOCK_NAMESPACE = "gym:invoice-top-up:";
const HASH_SEED = 0;

const TRY_LOCK = "SELECT pg_try_advisory_lock(hashtextextended($1, $2)) AS locked";
const UNLOCK = "SELECT pg_advisory_unlock(hashtextextended($1, $2))";

/**
 * One Postgres advisory lock per gym, held on a connection of its own for as long as the job
 * runs, so it is not tied to any transaction of the job. A second worker asking for the same gym
 * is told at once that it is taken. The worker process is short lived, so a lock that could not be
 * handed back ends with its connection.
 */
export function makeTenantJobLock(pool: LockPool): TenantJobLock {
  return {
    async runExclusive<T>(tenantId: string, fn: () => Promise<T>): Promise<Exclusive<T>> {
      const key = [`${LOCK_NAMESPACE}${tenantId}`, HASH_SEED];
      const client = await pool.connect();
      try {
        const { rows } = await client.query(TRY_LOCK, key);
        if ((rows[0] as { locked: boolean }).locked !== true) return { ran: false };
        try {
          return { ran: true, value: await fn() };
        } finally {
          await client.query(UNLOCK, key);
        }
      } finally {
        client.release();
      }
    },
  };
}
