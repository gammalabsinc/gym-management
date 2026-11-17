import type { GymProvisioner } from "../../app/ports";
import { settingsToJson } from "../../domain/tenant";
import type { SqlExecutor } from "../db/sql-executor";

/**
 * Adds gyms. The tenants table has no row level security, because a gym is the row itself, so the
 * statements here name the gym by id or by its unique subdomain. `executor` runs inside the
 * transaction of the onboarding job.
 */
export function makeGymProvisioner(executor: SqlExecutor): GymProvisioner {
  return {
    async insertIfAbsent(gym) {
      const inserted = (await executor.query(
        `INSERT INTO tenants (id, name, subdomain, timezone, currency, settings)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (subdomain) DO NOTHING
         RETURNING id`,
        [
          gym.id,
          gym.name,
          gym.subdomain,
          gym.timezone,
          gym.currency,
          JSON.stringify(settingsToJson(gym.settings)),
        ],
      )) as unknown[];
      return inserted.length > 0;
    },

    async findIdBySubdomain(subdomain) {
      const [row] = (await executor.query("SELECT id FROM tenants WHERE subdomain = $1", [
        subdomain,
      ])) as { id: string }[];
      return row === undefined ? null : row.id;
    },
  };
}
