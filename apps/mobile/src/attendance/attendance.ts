import type { Client } from "../api/client";
import { query } from "../api/operation";

export interface VisitRow {
  readonly id: string;
  /** The day of the visit in the gym's time zone, as the API worked it out. */
  readonly localDate: string;
  readonly scannedAt: string;
}

export type FirstAttendance =
  | {
      readonly status: "ready";
      readonly memberId: string;
      readonly timezone: string;
      readonly visitsThisMonth: number;
      readonly visitsLastMonth: number;
      readonly items: readonly VisitRow[];
      readonly nextCursor: string | null;
    }
  | { readonly status: "failed"; readonly message: string };

export type MoreAttendance =
  | {
      readonly status: "page";
      readonly items: readonly VisitRow[];
      readonly nextCursor: string | null;
    }
  | { readonly status: "failed"; readonly message: string };

export interface AttendanceService {
  /** The member's identity, both counts and the newest visits. */
  first(): Promise<FirstAttendance>;
  /** The visits after a cursor, for the member found by `first`. */
  more(memberId: string, cursor: string): Promise<MoreAttendance>;
}

export const ATTENDANCE_MISSING_MESSAGE = "We could not find your visits.";
export const VISITS_PAGE_SIZE = 30;

const visitFields = { id: true, localDate: true, scannedAt: true } as const;

const identityQuery = query("MyVisitsIdentity", {
  me: { select: { memberId: true } },
  tenant: { select: { timezone: true } },
});

const firstQuery = (memberId: string) =>
  query("MyVisits", {
    member: { args: { id: memberId }, select: { visitsThisMonth: true, visitsLastMonth: true } },
    visits: {
      args: { memberId, page: { limit: VISITS_PAGE_SIZE } },
      select: { items: visitFields, nextCursor: true },
    },
  });

const moreQuery = (memberId: string, cursor: string) =>
  query("MyMoreVisits", {
    visits: {
      args: { memberId, page: { limit: VISITS_PAGE_SIZE, cursor } },
      select: { items: visitFields, nextCursor: true },
    },
  });

function rowsOf(
  items: readonly { readonly id: string; readonly localDate: string; readonly scannedAt: string }[],
): VisitRow[] {
  return items.map((item) => ({
    id: item.id,
    localDate: item.localDate,
    scannedAt: item.scannedAt,
  }));
}

export function createAttendanceService(deps: {
  readonly client: Pick<Client, "execute">;
}): AttendanceService {
  const failed = (message: string): { readonly status: "failed"; readonly message: string } => ({
    status: "failed",
    message,
  });

  return {
    async first() {
      const identity = await deps.client.execute(identityQuery);
      if (identity.status === "network") return failed(identity.message);
      if (identity.status === "error") return failed(identity.error.message);
      if (identity.status === "empty") return failed(ATTENDANCE_MISSING_MESSAGE);
      const { me, tenant } = identity.data;
      if (me.memberId === null || me.memberId === undefined) {
        return failed(ATTENDANCE_MISSING_MESSAGE);
      }
      const memberId = me.memberId;

      const result = await deps.client.execute(firstQuery(memberId));
      if (result.status === "network") return failed(result.message);
      if (result.status === "error") return failed(result.error.message);
      if (result.status === "empty") return failed(ATTENDANCE_MISSING_MESSAGE);
      const { member, visits } = result.data;
      if (member === null || member === undefined) return failed(ATTENDANCE_MISSING_MESSAGE);
      return {
        status: "ready",
        memberId,
        timezone: tenant.timezone,
        visitsThisMonth: member.visitsThisMonth,
        visitsLastMonth: member.visitsLastMonth,
        items: rowsOf(visits.items),
        nextCursor: visits.nextCursor ?? null,
      };
    },

    async more(memberId, cursor) {
      const result = await deps.client.execute(moreQuery(memberId, cursor));
      if (result.status === "network") return failed(result.message);
      if (result.status === "error") return failed(result.error.message);
      if (result.status === "empty") return { status: "page", items: [], nextCursor: null };
      return {
        status: "page",
        items: rowsOf(result.data.visits.items),
        nextCursor: result.data.visits.nextCursor ?? null,
      };
    },
  };
}
