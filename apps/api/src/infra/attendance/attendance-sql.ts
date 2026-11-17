import type { ScanStore } from "../../app/ports";
import type { MembershipStatus } from "../../domain/standing";
import type { SqlExecutor } from "../db/sql-executor";

const DATE = "'YYYY-MM-DD'";
const UTC_TIMESTAMP = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

interface MemberRow {
  id: string;
  status: MembershipStatus;
  status_since: string;
}

/**
 * The attendance log of one tenant. Every statement names the tenant, and row level security
 * checks it again. The barcode index is unique across all gyms, but a lookup also names the
 * tenant, so a code of another gym finds nothing, exactly like a code nobody holds. `executor`
 * must run inside the tenant transaction, so the member lock lasts until the scan is written.
 */
export function makeScanStore(executor: SqlExecutor, tenantId: string): ScanStore {
  /** `column` is one of two constants of this file, never client input. The value is a parameter. */
  async function lockMember(column: "m.barcode" | "m.id", value: string) {
    const rows = (await executor.query(
      `SELECT m.id, p.status, to_char(p.valid_from, ${DATE}) AS status_since
         FROM members m
         JOIN membership_periods p
           ON p.tenant_id = m.tenant_id AND p.member_id = m.id AND p.valid_to IS NULL
        WHERE m.tenant_id = $1 AND ${column} = $2
          FOR UPDATE OF m`,
      [tenantId, value],
    )) as MemberRow[];
    const [row] = rows;
    return row === undefined
      ? null
      : { id: row.id, status: row.status, statusSince: row.status_since };
  }

  return {
    lockByBarcode: (barcode) => lockMember("m.barcode", barcode),

    lockById: (memberId) => lockMember("m.id", memberId),

    async originalScanWithin(memberId, now, windowMinutes) {
      const rows = (await executor.query(
        `SELECT to_char(scanned_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP}) AS scanned_at
           FROM attendance
          WHERE tenant_id = $1 AND member_id = $2 AND NOT is_duplicate
            AND scanned_at > $3::timestamptz - make_interval(mins => $4::int)
          ORDER BY scanned_at DESC
          LIMIT 1`,
        [tenantId, memberId, now, windowMinutes],
      )) as { scanned_at: string }[];
      return rows[0]?.scanned_at ?? null;
    },

    async insert(row) {
      const rows = (await executor.query(
        `INSERT INTO attendance
           (tenant_id, member_id, scanned_at, local_date, is_duplicate, status_at_scan, source,
            recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          tenantId,
          row.memberId,
          row.scannedAt,
          row.localDate,
          row.isDuplicate,
          row.statusAtScan,
          row.source,
          row.recordedBy,
        ],
      )) as { id: string }[];
      const [created] = rows;
      if (created === undefined) throw new Error("The scan was not stored");
      return created.id;
    },
  };
}
