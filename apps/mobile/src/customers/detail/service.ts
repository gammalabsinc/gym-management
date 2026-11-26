import type { Client } from "../../api/client";
import { mutation, query } from "../../api/operation";

export type MemberStatus = "ACTIVE" | "PAUSED" | "CANCELLED";
export type Standing = "PAID" | "DUE_SOON" | "OVERDUE" | "INACTIVE";

export interface DetailHeader {
  readonly memberId: string;
  readonly memberNo: string;
  readonly name: string | null;
  readonly planName: string;
  readonly status: MemberStatus;
  readonly standing: Standing;
  readonly paidThrough: string | null;
  readonly balanceDue: number;
  readonly credit: number;
  readonly currency: string;
  readonly timezone: string;
}

export type HeaderResult =
  | { readonly status: "data"; readonly header: DetailHeader }
  | { readonly status: "failed"; readonly message: string };

export interface InvoiceRow {
  readonly id: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly dueDate: string;
  readonly total: number;
  readonly amountDue: number;
  readonly isPaid: boolean;
  readonly isVoid: boolean;
  readonly voidReason: string | null;
}

export interface PaymentRow {
  readonly id: string;
  readonly amount: number;
  readonly method: "CASH" | "CARD" | "BANK_TRANSFER";
  readonly paidOn: string;
  readonly isVoid: boolean;
  readonly voidReason: string | null;
}

export interface VisitRow {
  readonly id: string;
  readonly scannedAt: string;
  readonly isDuplicate: boolean;
  readonly source: "STAFF_APP" | "MANUAL";
}

export interface DiscountRow {
  readonly id: string;
  readonly kind: "REFERRAL" | "MANUAL";
  readonly amount: number;
  readonly isRecurring: boolean;
  readonly reason: string | null;
  readonly isActive: boolean;
  readonly isConsumed: boolean;
  readonly startsOn: string;
  readonly endsOn: string | null;
}

export interface HistoryRow {
  readonly id: string;
  readonly status: MemberStatus;
  readonly validFrom: string;
  readonly validTo: string | null;
  readonly reason: string | null;
}

export type Page<Row> =
  | { readonly status: "page"; readonly items: readonly Row[]; readonly nextCursor: string | null }
  | { readonly status: "failed"; readonly message: string };

/** Loads one page of a tab. No cursor means the first page. */
export type PageLoader<Row> = (cursor?: string) => Promise<Page<Row>>;

export type ActionResult =
  | { readonly status: "done" }
  /** The server said the input is wrong, for example a missing reason. */
  | { readonly status: "invalid"; readonly message: string }
  /** The server refused because of the record's state, for example it was already voided. */
  | { readonly status: "refused"; readonly message: string }
  | { readonly status: "forbidden" }
  | { readonly status: "failed"; readonly message: string };

export interface NewDiscount {
  /** Integer minor units, more than zero. */
  readonly amount: number;
  readonly isRecurring: boolean;
  readonly reason: string;
}

export interface DetailService {
  header(memberId: string): Promise<HeaderResult>;
  invoices(memberId: string): PageLoader<InvoiceRow>;
  payments(memberId: string): PageLoader<PaymentRow>;
  visits(memberId: string): PageLoader<VisitRow>;
  discounts(memberId: string): PageLoader<DiscountRow>;
  history(memberId: string): PageLoader<HistoryRow>;
  /** Pause, resume or cancel. The reason is required. */
  changeStatus(memberId: string, status: MemberStatus, reason: string): Promise<ActionResult>;
  voidPayment(id: string, reason: string): Promise<ActionResult>;
  voidInvoice(id: string, reason: string): Promise<ActionResult>;
  /** A manual discount for one member. It reaches invoices generated after it, never earlier ones. */
  addDiscount(memberId: string, discount: NewDiscount): Promise<ActionResult>;
  /** Ends a monthly discount. The reason is required. */
  endDiscount(id: string, reason: string): Promise<ActionResult>;
}

export const PAGE_SIZE = 20;
export const MEMBER_MISSING_MESSAGE = "We could not find this customer.";
export const ACTION_FAILED_MESSAGE = "We could not save that change. Try again.";

const headerQuery = (id: string) =>
  query("CustomerHeader", {
    member: {
      args: { id },
      select: {
        memberNo: true,
        name: true,
        status: true,
        standing: true,
        paidThrough: true,
        balanceDue: true,
        credit: true,
        plan: { name: true },
      },
    },
    tenant: { select: { currency: true, timezone: true } },
  });

const page = (cursor: string | undefined) => ({
  limit: PAGE_SIZE,
  ...(cursor === undefined ? {} : { cursor }),
});

const invoicesQuery = (memberId: string, cursor: string | undefined) =>
  query("CustomerInvoices", {
    invoices: {
      args: { memberId, page: page(cursor) },
      select: {
        items: {
          id: true,
          periodStart: true,
          periodEnd: true,
          dueDate: true,
          total: true,
          amountDue: true,
          isPaid: true,
          isVoid: true,
          voidReason: true,
        },
        nextCursor: true,
      },
    },
  });

const paymentsQuery = (memberId: string, cursor: string | undefined) =>
  query("CustomerPayments", {
    payments: {
      args: { memberId, page: page(cursor) },
      select: {
        items: {
          id: true,
          amount: true,
          method: true,
          paidOn: true,
          isVoid: true,
          voidReason: true,
        },
        nextCursor: true,
      },
    },
  });

const visitsQuery = (memberId: string, cursor: string | undefined) =>
  query("CustomerVisits", {
    visits: {
      args: { memberId, page: page(cursor) },
      select: {
        items: { id: true, scannedAt: true, isDuplicate: true, source: true },
        nextCursor: true,
      },
    },
  });

const discountsQuery = (memberId: string) =>
  query("CustomerDiscounts", {
    discounts: {
      args: { memberId },
      select: {
        id: true,
        kind: true,
        amount: true,
        isRecurring: true,
        reason: true,
        isActive: true,
        isConsumed: true,
        startsOn: true,
        endsOn: true,
      },
    },
  });

const historyQuery = (memberId: string) =>
  query("CustomerHistory", {
    membershipPeriods: {
      args: { memberId },
      select: { id: true, status: true, validFrom: true, validTo: true, reason: true },
    },
  });

const problems = { code: true, field: true, message: true } as const;

const changeStatusMutation = (id: string, status: MemberStatus, reason: string) =>
  mutation("ChangeMembership", {
    updateMember: {
      args: { id, patch: { status, reason } },
      select: { member: { id: true }, errors: problems },
    },
  });

const voidPaymentMutation = (id: string, reason: string) =>
  mutation("VoidPayment", {
    voidPayment: { args: { id, reason }, select: { payment: { id: true }, errors: problems } },
  });

const voidInvoiceMutation = (id: string, reason: string) =>
  mutation("VoidInvoice", {
    voidInvoice: { args: { id, reason }, select: { invoice: { id: true }, errors: problems } },
  });

const addDiscountMutation = (memberId: string, discount: NewDiscount) =>
  mutation("AddDiscount", {
    addDiscount: {
      args: {
        input: {
          memberId,
          amount: discount.amount,
          isRecurring: discount.isRecurring,
          reason: discount.reason,
        },
      },
      select: { discount: { id: true }, errors: problems },
    },
  });

const endDiscountMutation = (id: string, reason: string) =>
  mutation("EndDiscount", {
    endDiscount: { args: { id, reason }, select: { discount: { id: true }, errors: problems } },
  });

interface Reported {
  readonly code: string;
  readonly message: string;
}

type Outcome =
  | { readonly status: "network"; readonly message: string }
  | {
      readonly status: "error";
      readonly error: { readonly code: string; readonly message: string };
    }
  | { readonly status: "empty" }
  | { readonly status: "data" };

function toAction(outcome: Outcome, errors: readonly Reported[] | null): ActionResult {
  if (outcome.status === "network") return { status: "failed", message: outcome.message };
  if (outcome.status === "error") {
    return outcome.error.code === "FORBIDDEN"
      ? { status: "forbidden" }
      : { status: "failed", message: outcome.error.message };
  }
  if (errors === null) return { status: "failed", message: ACTION_FAILED_MESSAGE };
  const first = errors[0];
  if (first === undefined) return { status: "done" };
  if (errors.some((error) => error.code === "FORBIDDEN")) return { status: "forbidden" };
  if (first.code === "INVALID_INPUT") return { status: "invalid", message: first.message };
  if (["CONFLICT", "ALREADY_VOID", "HAS_ALLOCATIONS"].includes(first.code)) {
    return { status: "refused", message: first.message };
  }
  return { status: "failed", message: first.message };
}

type Executed<Data> =
  | { readonly status: "network"; readonly message: string }
  | { readonly status: "error"; readonly error: { readonly message: string } }
  | { readonly status: "empty" }
  | { readonly status: "data"; readonly data: Data };

/** Anything that is not data becomes a failed page, and an empty answer an empty page. */
function toPage<Data, Row>(
  outcome: Executed<Data>,
  read: (data: Data) => { readonly items: readonly Row[]; readonly nextCursor: string | null },
): Page<Row> {
  if (outcome.status === "network") return { status: "failed", message: outcome.message };
  if (outcome.status === "error") return { status: "failed", message: outcome.error.message };
  if (outcome.status === "empty") return { status: "page", items: [], nextCursor: null };
  return { status: "page", ...read(outcome.data) };
}

export function createDetailService(deps: {
  readonly client: Pick<Client, "execute">;
}): DetailService {
  const { client } = deps;
  return {
    async header(memberId) {
      const outcome = await client.execute(headerQuery(memberId));
      if (outcome.status === "network") return { status: "failed", message: outcome.message };
      if (outcome.status === "error") return { status: "failed", message: outcome.error.message };
      if (outcome.status === "empty") return { status: "failed", message: MEMBER_MISSING_MESSAGE };
      const { member, tenant } = outcome.data;
      if (member === null || member === undefined) {
        return { status: "failed", message: MEMBER_MISSING_MESSAGE };
      }
      return {
        status: "data",
        header: {
          memberId,
          memberNo: member.memberNo,
          name: member.name ?? null,
          planName: member.plan.name,
          status: member.status,
          standing: member.standing,
          paidThrough: member.paidThrough ?? null,
          balanceDue: member.balanceDue,
          credit: member.credit,
          currency: tenant.currency,
          timezone: tenant.timezone,
        },
      };
    },

    invoices: (memberId) => async (cursor) =>
      toPage(await client.execute(invoicesQuery(memberId, cursor)), (data) => ({
        items: data.invoices.items.map((invoice) => ({
          ...invoice,
          voidReason: invoice.voidReason ?? null,
        })),
        nextCursor: data.invoices.nextCursor ?? null,
      })),

    payments: (memberId) => async (cursor) =>
      toPage(await client.execute(paymentsQuery(memberId, cursor)), (data) => ({
        items: data.payments.items.map((payment) => ({
          ...payment,
          voidReason: payment.voidReason ?? null,
        })),
        nextCursor: data.payments.nextCursor ?? null,
      })),

    visits: (memberId) => async (cursor) =>
      toPage(await client.execute(visitsQuery(memberId, cursor)), (data) => ({
        items: data.visits.items,
        nextCursor: data.visits.nextCursor ?? null,
      })),

    // Discounts and history come as one list, so they have no further pages.
    discounts: (memberId) => async () =>
      toPage(await client.execute(discountsQuery(memberId)), (data) => ({
        items: data.discounts.map((discount) => ({
          ...discount,
          reason: discount.reason ?? null,
          endsOn: discount.endsOn ?? null,
        })),
        nextCursor: null,
      })),

    history: (memberId) => async () =>
      toPage(await client.execute(historyQuery(memberId)), (data) => ({
        items: data.membershipPeriods.map((period) => ({
          ...period,
          validTo: period.validTo ?? null,
          reason: period.reason ?? null,
        })),
        nextCursor: null,
      })),

    async changeStatus(memberId, status, reason) {
      const outcome = await client.execute(changeStatusMutation(memberId, status, reason));
      return toAction(outcome, outcome.status === "data" ? outcome.data.updateMember.errors : null);
    },

    async voidPayment(id, reason) {
      const outcome = await client.execute(voidPaymentMutation(id, reason));
      return toAction(outcome, outcome.status === "data" ? outcome.data.voidPayment.errors : null);
    },

    async voidInvoice(id, reason) {
      const outcome = await client.execute(voidInvoiceMutation(id, reason));
      return toAction(outcome, outcome.status === "data" ? outcome.data.voidInvoice.errors : null);
    },

    async addDiscount(memberId, discount) {
      const outcome = await client.execute(addDiscountMutation(memberId, discount));
      return toAction(outcome, outcome.status === "data" ? outcome.data.addDiscount.errors : null);
    },

    async endDiscount(id, reason) {
      const outcome = await client.execute(endDiscountMutation(id, reason));
      return toAction(outcome, outcome.status === "data" ? outcome.data.endDiscount.errors : null);
    },
  };
}
