import type { ProfileStore } from "../../app/ports";
import type { SqlExecutor } from "../db/sql-executor";

interface ProfileRow {
  user_id: string;
  name: string | null;
  phone: string | null;
}

/**
 * The profile fields of the members of one tenant. They live on the user row, and only name and
 * phone are ever written here, so member_no, barcode and email are out of reach of this store.
 */
export function makeProfileStore(executor: SqlExecutor, tenantId: string): ProfileStore {
  return {
    async lock(memberId) {
      const [row] = (await executor.query(
        `SELECT u.id AS user_id, u.name, u.phone
           FROM members m
           JOIN users u ON u.tenant_id = m.tenant_id AND u.id = m.user_id
          WHERE m.tenant_id = $1 AND m.id = $2
            FOR UPDATE OF u`,
        [tenantId, memberId],
      )) as ProfileRow[];
      return row === undefined ? null : { userId: row.user_id, name: row.name, phone: row.phone };
    },

    async update(userId, change) {
      await executor.query(
        `UPDATE users
            SET name = CASE WHEN $3::boolean THEN $4 ELSE name END,
                phone = CASE WHEN $5::boolean THEN $6 ELSE phone END,
                updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [
          tenantId,
          userId,
          change.name !== undefined,
          change.name ?? null,
          change.phone !== undefined,
          change.phone ?? null,
        ],
      );
    },
  };
}
