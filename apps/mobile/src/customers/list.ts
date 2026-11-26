import type { Client } from "../api/client";
import { query } from "../api/operation";

export interface CustomerRow {
  readonly id: string;
  readonly name: string | null;
  readonly status: "ACTIVE" | "PAUSED" | "CANCELLED";
  readonly standing: "PAID" | "DUE_SOON" | "OVERDUE" | "INACTIVE";
  readonly paidThrough: string | null;
  readonly balanceDue: number;
  readonly visitsThisMonth: number;
  readonly visitsLastMonth: number;
  readonly totalPaid: number;
  readonly currency: string;
}

export type CustomerPage =
  | {
      readonly status: "page";
      readonly items: readonly CustomerRow[];
      readonly nextCursor: string | null;
    }
  | { readonly status: "failed"; readonly message: string };

export interface CustomersService {
  /** One page, in the server's order. A cursor continues the same search. */
  fetch(request: { readonly search: string; readonly cursor?: string }): Promise<CustomerPage>;
}

export const PAGE_SIZE = 25;

const customersQuery = (search: string, cursor: string | undefined) =>
  query("Customers", {
    members: {
      args: {
        ...(search === "" ? {} : { search }),
        page: { limit: PAGE_SIZE, ...(cursor === undefined ? {} : { cursor }) },
      },
      select: {
        items: {
          id: true,
          name: true,
          status: true,
          standing: true,
          paidThrough: true,
          balanceDue: true,
          visitsThisMonth: true,
          visitsLastMonth: true,
          totalPaid: true,
        },
        nextCursor: true,
      },
    },
    tenant: { select: { currency: true } },
  });

export function createCustomersService(deps: {
  readonly client: Pick<Client, "execute">;
}): CustomersService {
  return {
    async fetch(request) {
      const outcome = await deps.client.execute(
        customersQuery(request.search.trim(), request.cursor),
      );
      switch (outcome.status) {
        case "network":
          return { status: "failed", message: outcome.message };
        case "error":
          return { status: "failed", message: outcome.error.message };
        case "empty":
          return { status: "page", items: [], nextCursor: null };
        case "data": {
          const { members, tenant } = outcome.data;
          return {
            status: "page",
            // The server's order is kept. Nothing here sorts.
            items: members.items.map((member) => ({
              id: member.id,
              name: member.name ?? null,
              status: member.status,
              standing: member.standing,
              paidThrough: member.paidThrough ?? null,
              balanceDue: member.balanceDue,
              visitsThisMonth: member.visitsThisMonth,
              visitsLastMonth: member.visitsLastMonth,
              totalPaid: member.totalPaid,
              currency: tenant.currency,
            })),
            nextCursor: members.nextCursor ?? null,
          };
        }
      }
    },
  };
}
