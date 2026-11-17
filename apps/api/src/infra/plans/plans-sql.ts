import type { PlanStore } from "../../app/ports";
import type { Plan } from "../../domain/plans";
import type { SqlExecutor } from "../db/sql-executor";

interface PlanRow {
  id: string;
  key: string;
  name: string;
  admission_fee: number;
  monthly_fee: number;
  is_active: boolean;
}

const COLUMNS = "id, key, name, admission_fee, monthly_fee, is_active";

function toPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    admissionFee: row.admission_fee,
    monthlyFee: row.monthly_fee,
    isActive: row.is_active,
  };
}

/**
 * The plans of one tenant. Every statement names the tenant, and row level security checks it
 * again. `executor` must run inside the tenant transaction.
 */
export function makePlanStore(executor: SqlExecutor, tenantId: string): PlanStore {
  async function rows(sql: string, params: unknown[]): Promise<Plan[]> {
    return ((await executor.query(sql, params)) as PlanRow[]).map(toPlan);
  }

  return {
    list: () => rows(`SELECT ${COLUMNS} FROM plans WHERE tenant_id = $1 ORDER BY key`, [tenantId]),

    async findByKey(key) {
      const [plan] = await rows(`SELECT ${COLUMNS} FROM plans WHERE tenant_id = $1 AND key = $2`, [
        tenantId,
        key,
      ]);
      return plan ?? null;
    },

    findMany: (ids) =>
      rows(`SELECT ${COLUMNS} FROM plans WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [
        tenantId,
        ids,
      ]),

    async findForUpdate(id) {
      const [plan] = await rows(
        `SELECT ${COLUMNS} FROM plans WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, id],
      );
      return plan ?? null;
    },

    async update(id, fields) {
      await executor.query(
        `UPDATE plans SET name = $3, admission_fee = $4, monthly_fee = $5, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id, fields.name, fields.admissionFee, fields.monthlyFee],
      );
    },

    async insertIfAbsent(plan) {
      const [inserted] = await rows(
        `INSERT INTO plans (tenant_id, key, name, admission_fee, monthly_fee)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, key) DO NOTHING
         RETURNING ${COLUMNS}`,
        [tenantId, plan.key, plan.name, plan.admissionFee, plan.monthlyFee],
      );
      return inserted ?? null;
    },
  };
}
