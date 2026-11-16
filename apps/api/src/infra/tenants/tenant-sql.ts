import type { TenantStore } from "../../app/ports";
import { brandingFromJson, settingsFromJson, type Tenant } from "../../domain/tenant";
import type { SqlExecutor } from "../db/sql-executor";

interface TenantRow {
  id: string;
  name: string;
  subdomain: string;
  timezone: string;
  currency: string;
  branding: unknown;
  settings: unknown;
}

const SELECT_TENANT =
  "SELECT id, name, subdomain, timezone, currency, branding, settings FROM tenants WHERE id = $1";

function toTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    subdomain: row.subdomain,
    timezone: row.timezone,
    currency: row.currency,
    branding: brandingFromJson(row.branding),
    settings: settingsFromJson(row.settings),
  };
}

/**
 * The row of one gym. The tenants table has no row level security, because the tenant is the row
 * itself, so every statement here names the tenant id of the transaction and nothing else.
 */
export function makeTenantStore(executor: SqlExecutor, tenantId: string): TenantStore {
  async function read(sql: string): Promise<Tenant | null> {
    const [row] = (await executor.query(sql, [tenantId])) as TenantRow[];
    return row === undefined ? null : toTenant(row);
  }

  return {
    find: () => read(SELECT_TENANT),
    findForUpdate: () => read(`${SELECT_TENANT} FOR UPDATE`),

    async mergeSettings(json) {
      await executor.query(
        "UPDATE tenants SET settings = settings || $2::jsonb, updated_at = now() WHERE id = $1",
        [tenantId, JSON.stringify(json)],
      );
    },
  };
}
