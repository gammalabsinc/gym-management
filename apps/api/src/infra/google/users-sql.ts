import type { GoogleUser, GoogleUserDirectory } from "../../app/ports";

export interface SqlExecutor {
  query(sql: string, params: unknown[]): Promise<unknown>;
}

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  name: string | null;
}

const GOOGLE = "google";

function toUser(row: UserRow): GoogleUser {
  return { id: row.id, tenantId: row.tenant_id, email: row.email, name: row.name };
}

/**
 * Upserts on (tenant_id, auth_subject), so the Google subject decides who the user is.
 * Run it with the executor of a tenant scoped transaction.
 */
export function makeGoogleUserDirectory(executor: SqlExecutor): GoogleUserDirectory {
  return {
    async upsertBySubject(tenantId, identity) {
      const rows = (await executor.query(
        `INSERT INTO users (tenant_id, email, name, auth_provider, auth_subject)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, auth_subject)
         DO UPDATE SET email = EXCLUDED.email,
                       name = COALESCE(EXCLUDED.name, users.name),
                       updated_at = now()
         RETURNING id, tenant_id, email, name`,
        [tenantId, identity.email, identity.name, GOOGLE, identity.subject],
      )) as UserRow[];
      return toUser(rows[0] as UserRow);
    },
  };
}
