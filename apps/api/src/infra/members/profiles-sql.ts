import type { ProfileStore } from "../../app/ports";
import type { SqlExecutor } from "../db/sql-executor";

interface ProfileRow {
  user_id: string;
  name: string | null;
  phone: string | null;
  photo_ref: string | null;
}

/**
 * The profile fields of the members of one tenant. They live on the user row, and only name,
 * phone and photo reference are ever written here, so member_no, barcode and email are out of reach of this store.
 */
export function makeProfileStore(executor: SqlExecutor, tenantId: string): ProfileStore {
  return {
    async lock(memberId) {
      const [row] = (await executor.query(
        `SELECT u.id AS user_id, u.name, u.phone, u.photo_ref
           FROM members m
           JOIN users u ON u.tenant_id = m.tenant_id AND u.id = m.user_id
          WHERE m.tenant_id = $1 AND m.id = $2
            FOR UPDATE OF u`,
        [tenantId, memberId],
      )) as ProfileRow[];
      return row === undefined
        ? null
        : { userId: row.user_id, name: row.name, phone: row.phone, photoRef: row.photo_ref };
    },

    async update(userId, change) {
      await executor.query(
        `UPDATE users
            SET name = CASE WHEN $3::boolean THEN $4 ELSE name END,
                phone = CASE WHEN $5::boolean THEN $6 ELSE phone END,
                photo_ref = CASE WHEN $7::boolean THEN $8 ELSE photo_ref END,
                updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [
          tenantId,
          userId,
          change.name !== undefined,
          change.name ?? null,
          change.phone !== undefined,
          change.phone ?? null,
          change.photoRef !== undefined,
          change.photoRef ?? null,
        ],
      );
    },
  };
}
