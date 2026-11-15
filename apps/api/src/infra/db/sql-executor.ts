/** The one method the SQL adapters need from a pg client or a transaction. */
export interface SqlExecutor {
  query(sql: string, params: unknown[]): Promise<unknown>;
}
