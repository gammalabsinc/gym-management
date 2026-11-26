import { formatMonth } from "../ui/dates";
import type { VisitRow } from "./attendance";

export type AttendanceListRow =
  | { readonly kind: "month"; readonly key: string; readonly label: string }
  | { readonly kind: "visit"; readonly key: string; readonly visit: VisitRow };

/**
 * Visits in the order the API sent them, with a heading row where the month changes. The month is
 * read from the API's own `localDate`, which is already in the gym's time zone, so the phone's
 * time zone never moves a visit into another month. Nothing is sorted.
 */
export function toListRows(visits: readonly VisitRow[]): AttendanceListRow[] {
  const rows: AttendanceListRow[] = [];
  let currentMonth: string | null = null;
  for (const visit of visits) {
    const month = visit.localDate.slice(0, 7);
    if (month !== currentMonth) {
      rows.push({ kind: "month", key: `month-${month}`, label: formatMonth(month) });
      currentMonth = month;
    }
    rows.push({ kind: "visit", key: `visit-${visit.id}`, visit });
  }
  return rows;
}
