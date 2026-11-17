import type { MemberSelfStore } from "../../app/ports";
import type { SqlExecutor } from "../db/sql-executor";

/**
 * Maps a user to their member record. The statement names the tenant and row level security
 * checks it again, so a user id from another gym finds nothing.
 */
export function makeMemberSelfStore(executor: SqlExecutor, tenantId: string): MemberSelfStore {
  return {
    async memberIdOfUser(userId) {
      const [row] = (await executor.query(
        "SELECT id FROM members WHERE tenant_id = $1 AND user_id = $2",
        [tenantId, userId],
      )) as { id: string }[];
      return row === undefined ? null : row.id;
    },
  };
}
