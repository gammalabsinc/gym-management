import type { StaffDirectory, StaffRecord } from "../../app/ports";
import type { Role } from "../../domain/permissions";
import type { SqlExecutor } from "../db/sql-executor";

interface StaffRow {
  id: string;
  name: string | null;
  email: string;
  auth_subject: string | null;
  roles: Role[];
}

/** One row per user of the tenant, with the roles gathered into an array (empty for none). */
const SELECT_USERS = `
  SELECT u.id, u.name, u.email, u.auth_subject,
         COALESCE(array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
    FROM users u
    LEFT JOIN user_roles r ON r.tenant_id = u.tenant_id AND r.user_id = u.id
   WHERE u.tenant_id = $1`;

const GROUP_USERS = "GROUP BY u.id";

function toRecord(row: StaffRow): StaffRecord {
  return {
    userId: row.id,
    name: row.name,
    email: row.email,
    roles: row.roles,
    authSubject: row.auth_subject,
  };
}

/**
 * The staff directory of one tenant. Every statement names the tenant, and row level security
 * checks it again, so a bug here cannot reach another gym's rows. `executor` must run inside the
 * tenant transaction, which is what keeps the owner lock until the use case commits.
 */
export function makeStaffDirectory(executor: SqlExecutor, tenantId: string): StaffDirectory {
  async function rows(sql: string, params: unknown[]): Promise<StaffRow[]> {
    return (await executor.query(sql, params)) as StaffRow[];
  }

  return {
    async list() {
      const found = await rows(
        `${SELECT_USERS} ${GROUP_USERS}
         HAVING bool_or(r.role IN ('owner', 'staff'))
         ORDER BY u.email`,
        [tenantId],
      );
      return found.map(toRecord);
    },

    async find(userId) {
      const [row] = await rows(`${SELECT_USERS} AND u.id = $2 ${GROUP_USERS}`, [tenantId, userId]);
      return row === undefined ? null : toRecord(row);
    },

    async findByEmail(email) {
      const [row] = await rows(`${SELECT_USERS} AND u.email = $2 ${GROUP_USERS}`, [
        tenantId,
        email,
      ]);
      return row === undefined ? null : toRecord(row);
    },

    async lockOwners() {
      const owners = (await executor.query(
        `SELECT user_id FROM user_roles
          WHERE tenant_id = $1 AND role = 'owner'
          ORDER BY user_id
            FOR UPDATE`,
        [tenantId],
      )) as { user_id: string }[];
      return owners.map((owner) => owner.user_id);
    },

    async createUser(user) {
      const [row] = (await executor.query(
        `INSERT INTO users (tenant_id, email, name) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, email) DO NOTHING
         RETURNING id`,
        [tenantId, user.email, user.name],
      )) as { id: string }[];
      return row === undefined ? null : row.id;
    },

    async addRole(userId, role) {
      const added = (await executor.query(
        `INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING role`,
        [tenantId, userId, role],
      )) as unknown[];
      return added.length > 0;
    },

    async removeRole(userId, role) {
      const removed = (await executor.query(
        `DELETE FROM user_roles WHERE tenant_id = $1 AND user_id = $2 AND role = $3
         RETURNING role`,
        [tenantId, userId, role],
      )) as unknown[];
      return removed.length > 0;
    },
  };
}
