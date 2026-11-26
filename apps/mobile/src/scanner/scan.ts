import type { Client } from "../api/client";
import { mutation } from "../api/operation";

export type Standing = "PAID" | "DUE_SOON" | "OVERDUE" | "INACTIVE";

export type ScanOutcome =
  | {
      readonly status: "recorded";
      readonly memberName: string | null;
      readonly standing: Standing;
      readonly paidThrough: string | null;
      /** The member was already scanned inside the repeat window. */
      readonly isDuplicate: boolean;
    }
  | { readonly status: "notRecognized" }
  /** No connection. Nothing is queued, the scan was not saved. */
  | { readonly status: "offline" }
  | { readonly status: "failed"; readonly message: string };

export interface ScanService {
  record(barcode: string): Promise<ScanOutcome>;
}

export const SCAN_FAILED_MESSAGE = "That scan could not be saved. Try again.";

const recordScan = (barcode: string) =>
  mutation("RecordScan", {
    recordScan: {
      args: { barcode },
      select: {
        visit: { isDuplicate: true },
        member: { name: true, standing: true, paidThrough: true },
        errors: { code: true },
      },
    },
  });

export function createScanService(deps: { readonly client: Pick<Client, "execute"> }): ScanService {
  return {
    async record(barcode) {
      const outcome = await deps.client.execute(recordScan(barcode));
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
            memberName: member.name ?? null,
            standing: member.standing,
            paidThrough: member.paidThrough ?? null,
            isDuplicate: visit.isDuplicate,
          };
        }
      }
    },
  };
}
