export interface SqlClient {
  query(sql: string): Promise<{ rows: unknown[] }>;
}

/**
 * Names every table with a tenant_id column that does not isolate tenants: row level security
 * not enabled, not forced, or no policy. CI fails while this list is not empty.
 */
export async function findUnprotectedTenantTables(client: SqlClient): Promise<string[]> {
  const { rows } = await client.query(`
    SELECT c.relname AS name
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE a.attname = 'tenant_id'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND c.relkind IN ('r', 'p')
      AND n.nspname = 'public'
      AND NOT (
        c.relrowsecurity
        AND c.relforcerowsecurity
        AND EXISTS (
          SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid
        )
      )
    ORDER BY c.relname
  `);
  return (rows as { name: string }[]).map((row) => row.name);
}
