import type { Client } from "../api/client";
import { mutation, query } from "../api/operation";

export type Standing = "PAID" | "DUE_SOON" | "OVERDUE" | "INACTIVE";

export type Membership = "ACTIVE" | "PAUSED" | "CANCELLED";

export type ScanOutcome =
  | {
      readonly status: "recorded";
      readonly memberId: string;
      readonly memberName: string | null;
      readonly standing: Standing;
      readonly paidThrough: string | null;
      readonly membership: Membership;
      /** The gym's local date the member left, null while the membership has not ended. */
      readonly leftOn: string | null;
      /** The member was already scanned inside the repeat window. */
      readonly isDuplicate: boolean;
    }
  | { readonly status: "notRecognized" }
  /** No connection. Nothing is queued, the scan was not saved. */
  | { readonly status: "offline" }
  | { readonly status: "failed"; readonly message: string };

/** When a repeated scan was first checked in, in the gym's time zone. */
export type FirstCheckIn =
  | { readonly status: "found"; readonly at: string; readonly timezone: string }
  | { readonly status: "unknown" };

/** A scan from the camera, or a check in the person at the desk chose from a search. */
export type ScanSource = "STAFF_APP" | "MANUAL";

export interface SearchRow {
  readonly memberId: string;
  readonly barcode: string;
  readonly name: string | null;
  readonly memberNo: string;
  readonly status: Membership;
  readonly standing: Standing;
}

export type SearchResult =
  | { readonly status: "results"; readonly rows: readonly SearchRow[] }
  | { readonly status: "failed"; readonly message: string };

export interface ScanService {
  record(barcode: string, source?: ScanSource): Promise<ScanOutcome>;
  /** Members matching a name, email or member number, in the server's order. Blank text asks nothing. */
  search(text: string): Promise<SearchResult>;
  /** The original check in behind a repeated scan. Any failure answers `unknown`, it never blocks. */
  firstCheckIn(memberId: string): Promise<FirstCheckIn>;
}

export const SCAN_FAILED_MESSAGE = "That scan could not be saved. Try again.";

const recordScan = (barcode: string, source: ScanSource) =>
  mutation("RecordScan", {
    recordScan: {
      args: source === "MANUAL" ? { barcode, source } : { barcode },
      select: {
        visit: { isDuplicate: true },
        member: {
          id: true,
          name: true,
          standing: true,
          paidThrough: true,
          status: true,
          leftOn: true,
        },
        errors: { code: true },
      },
    },
  });

/** The newest visits, of which the newest one that is not itself a repeat is the original check in. */
export const RECENT_VISITS = 5;

const recentVisits = (memberId: string) =>
  query("OriginalCheckIn", {
    tenant: { select: { timezone: true } },
    visits: {
      args: { memberId, page: { limit: RECENT_VISITS } },
      select: { items: { scannedAt: true, isDuplicate: true } },
    },
  });

/** Enough rows to find someone at the desk. Typing more narrows the list, so there is no paging. */
export const SEARCH_LIMIT = 20;

export const SEARCH_FAILED_MESSAGE = "Could not search. Try again.";

const memberSearch = (search: string) =>
  query("CheckInSearch", {
    members: {
      args: { search, page: { limit: SEARCH_LIMIT } },
      select: {
        items: {
          id: true,
          barcode: true,
          name: true,
          memberNo: true,
          status: true,
          standing: true,
        },
      },
    },
  });

export function createScanService(deps: { readonly client: Pick<Client, "execute"> }): ScanService {
  return {
    async record(barcode, source = "STAFF_APP") {
      const outcome = await deps.client.execute(recordScan(barcode, source));
      switch (outcome.status) {
        case "network":
          return { status: "offline" };
        case "error":
          return { status: "failed", message: outcome.error.message };
        case "empty":
          return { status: "failed", message: SCAN_FAILED_MESSAGE };
        case "data": {
          const payload = outcome.data.recordScan;
          if (payload.errors.some((error) => error.code === "NOT_FOUND")) {
            return { status: "notRecognized" };
          }
          const { visit, member } = payload;
          if (payload.errors.length > 0 || visit == null || member == null) {
            return { status: "failed", message: SCAN_FAILED_MESSAGE };
          }
          return {
            status: "recorded",
            memberId: member.id,
            memberName: member.name ?? null,
            standing: member.standing,
            paidThrough: member.paidThrough ?? null,
            membership: member.status,
            leftOn: member.leftOn ?? null,
            isDuplicate: visit.isDuplicate,
          };
        }
      }
    },

    async search(text) {
      const trimmed = text.trim();
      if (trimmed === "") return { status: "results", rows: [] };
      const outcome = await deps.client.execute(memberSearch(trimmed));
      switch (outcome.status) {
        case "network":
          return { status: "failed", message: outcome.message };
        case "error":
          return { status: "failed", message: outcome.error.message };
        case "empty":
          return { status: "results", rows: [] };
        case "data":
          return {
            status: "results",
            rows: outcome.data.members.items.map((member) => ({
              memberId: member.id,
              barcode: member.barcode,
              name: member.name ?? null,
              memberNo: member.memberNo,
              status: member.status,
              standing: member.standing,
            })),
          };
      }
    },

    async firstCheckIn(memberId) {
      const outcome = await deps.client.execute(recentVisits(memberId));
      if (outcome.status !== "data") return { status: "unknown" };
      const original = outcome.data.visits.items.find((visit) => !visit.isDuplicate);
      if (original === undefined) return { status: "unknown" };
      return { status: "found", at: original.scannedAt, timezone: outcome.data.tenant.timezone };
    },
  };
}
