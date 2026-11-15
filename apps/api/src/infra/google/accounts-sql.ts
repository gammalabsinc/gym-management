import type { AccountDirectory, GymAccount } from "../../app/ports";
import { CLAIM_EMAIL_SETTING, CLAIM_SUBJECT_SETTING } from "../db/claim-settings";
import type { SqlExecutor } from "../db/sql-executor";

/** Runs `fn` in one transaction and commits it, or rolls it back when `fn` throws. */
export type RunInTransaction = <T>(fn: (executor: SqlExecutor) => Promise<T>) => Promise<T>;

interface AccountRow {
  id: string;
  tenant_id: string;
}

const GOOGLE = "google";

/**
 * Runs in its own transaction and tells row level security who is claiming, so it can see the
 * waiting rows in every gym (see the account claim policies). Outside this transaction the same
 * connection sees no user rows at all.
 *
 * Links first, then lists. The link only touches rows with no subject yet, so a row that belongs
 * to another Google account is never taken over. The NOT EXISTS keeps the unique
 * (tenant_id, auth_subject) from failing when the same person already holds a row in a gym under an
 * older email: that new row waits unclaimed. The email is compared lower case, which is how every
 * row is stored.
 */
export function makeAccountDirectory(transact: RunInTransaction): AccountDirectory {
  return {
    claim(identity) {
      const email = identity.email.toLowerCase();
      return transact(async (executor) => {
        await executor.query("SELECT set_config($1, $2, true), set_config($3, $4, true)", [
          CLAIM_EMAIL_SETTING,
          email,
          CLAIM_SUBJECT_SETTING,
          identity.subject,
        ]);
        await executor.query(
          `UPDATE users
              SET auth_subject = $1, auth_provider = $3, updated_at = now()
            WHERE email = $2
              AND auth_subject IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM users linked
                 WHERE linked.tenant_id = users.tenant_id AND linked.auth_subject = $1)`,
          [identity.subject, email, GOOGLE],
        );
        const rows = (await executor.query(
          "SELECT id, tenant_id FROM users WHERE auth_subject = $1 ORDER BY tenant_id, id",
          [identity.subject],
        )) as AccountRow[];
        return rows.map((row): GymAccount => ({ userId: row.id, tenantId: row.tenant_id }));
      });
    },
  };
}
