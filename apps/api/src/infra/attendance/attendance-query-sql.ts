import type { AttendanceQueryStore, AttendanceRecord, MonthVisits } from "../../app/ports";
import type { AttendancePosition } from "../../domain/attendance-query";
import type { ScanSource } from "../../domain/scan";
import type { Standing } from "../../domain/standing";
import type { SqlExecutor } from "../db/sql-executor";

const DATE = "'YYYY-MM-DD'";
const UTC_TIMESTAMP = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

interface RecordRow {
  id: string;
  member_id: string;
  member_name: string | null;
  scanned_at: string;
  local_date: string;
  is_duplicate: boolean;
  status_at_scan: Standing;
  source: ScanSource;
}

function toRecord(row: RecordRow): AttendanceRecord {
  return {
    id: row.id,
    memberId: row.member_id,
    memberName: row.member_name,
    scannedAt: row.scanned_at,
    localDate: row.local_date,
    isDuplicate: row.is_duplicate,
    statusAtScan: row.status_at_scan,
    source: row.source,
  };
}

/** The columns every list shows. The member is joined in, so a row carries the name staff look for. */
const SELECT_RECORDS = `
  SELECT a.id, a.member_id, u.name AS member_name,
         to_char(a.scanned_at AT TIME ZONE 'UTC', ${UTC_TIMESTAMP}) AS scanned_at,
         to_char(a.local_date, ${DATE}) AS local_date,
         a.is_duplicate, a.status_at_scan, a.source
    FROM attendance a
    JOIN members m ON m.tenant_id = a.tenant_id AND m.id = a.member_id
    JOIN users u ON u.tenant_id = m.tenant_id AND u.id = m.user_id`;

/** Keyset paging, newest first. Both parameters are null on the first page. */
function afterClause(scannedAt: string, id: string): string {
  return `(${scannedAt}::timestamptz IS NULL OR (a.scanned_at, a.id) < (${scannedAt}::timestamptz, ${id}::uuid))`;
}

function positionParams(after: AttendancePosition | null): [string | null, string | null] {
  return after === null ? [null, null] : [after.scannedAt, after.id];
}

/**
 * Reads the attendance log of one tenant. Every statement names the tenant, and row level security
 * checks it again. The gym local day was stored with each scan, so month and day boundaries follow
 * the gym's time zone and never the UTC date. `executor` must run inside the tenant transaction.
 */
export function makeAttendanceQueryStore(
  executor: SqlExecutor,
  tenantId: string,
): AttendanceQueryStore {
  return {
    async memberExists(memberId) {
      const rows = (await executor.query("SELECT 1 FROM members WHERE tenant_id = $1 AND id = $2", [
        tenantId,
        memberId,
      ])) as unknown[];
      return rows.length > 0;
    },

    async history(memberId, page, includeDuplicates) {
      const [scannedAt, id] = positionParams(page.after);
      const rows = (await executor.query(
        `${SELECT_RECORDS}
          WHERE a.tenant_id = $1 AND a.member_id = $2
            AND ($3::boolean OR NOT a.is_duplicate)
            AND ${afterClause("$4", "$5")}
          ORDER BY a.scanned_at DESC, a.id DESC
          LIMIT $6`,
        [tenantId, memberId, includeDuplicates, scannedAt, id, page.limit],
      )) as RecordRow[];
      return rows.map(toRecord);
    },

    async onDay(localDate, page) {
      const [scannedAt, id] = positionParams(page.after);
      const rows = (await executor.query(
        `${SELECT_RECORDS}
          WHERE a.tenant_id = $1 AND a.local_date = $2::date
            AND ${afterClause("$3", "$4")}
          ORDER BY a.scanned_at DESC, a.id DESC
          LIMIT $5`,
        [tenantId, localDate, scannedAt, id, page.limit],
      )) as RecordRow[];
      return rows.map(toRecord);
    },

    async monthVisits(memberId, lastStart, thisStart, nextStart) {
      const rows = (await executor.query(
        `SELECT (count(*) FILTER (WHERE local_date >= $4::date AND local_date < $5::date))::int AS this_month,
                (count(*) FILTER (WHERE local_date >= $3::date AND local_date < $4::date))::int AS last_month
           FROM attendance
          WHERE tenant_id = $1 AND member_id = $2 AND NOT is_duplicate
            AND local_date >= $3::date AND local_date < $5::date`,
        [tenantId, memberId, lastStart, thisStart, nextStart],
      )) as { this_month: number; last_month: number }[];
      // An aggregate without GROUP BY always yields one row, so the zero start is never returned.
      return rows.reduce<MonthVisits>(
        (_, row) => ({ thisMonth: row.this_month, lastMonth: row.last_month }),
        { thisMonth: 0, lastMonth: 0 },
      );
    },

    async dailyCounts(from, to) {
      const rows = (await executor.query(
        `SELECT to_char(local_date, ${DATE}) AS day, count(*)::int AS visits
           FROM attendance
          WHERE tenant_id = $1 AND NOT is_duplicate
            AND local_date >= $2::date AND local_date <= $3::date
          GROUP BY local_date
          ORDER BY local_date`,
        [tenantId, from, to],
      )) as { day: string; visits: number }[];
      return rows.map((row) => ({ date: row.day, visits: row.visits }));
    },
  };
}
