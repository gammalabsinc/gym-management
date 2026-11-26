import type { Client } from "../../api/client";
import { mutation, query } from "../../api/operation";
import type { Method, PaymentErrors } from "./form";

export interface PaymentSetup {
  readonly memberName: string | null;
  readonly balanceDue: number;
  readonly paidThrough: string | null;
  readonly credit: number;
  readonly currency: string;
  readonly timezone: string;
}

export type SetupResult =
  | { readonly status: "ready"; readonly setup: PaymentSetup }
  | { readonly status: "failed"; readonly message: string };

/** What the server says a payment would do. The app adds nothing up and allocates nothing. */
export interface PaymentPreview {
  readonly invoicesCovered: number;
  readonly paidThroughAfter: string | null;
  readonly creditAfter: number;
}

export type PreviewResult =
  | { readonly status: "preview"; readonly preview: PaymentPreview }
  | { readonly status: "failed"; readonly message: string };

export interface NewPayment {
  /** Made when the form opens and sent again on every retry of that form. */
  readonly clientRequestId: string;
  readonly memberId: string;
  readonly amount: number;
  readonly method: Method;
  readonly paidOn: string;
  readonly proofLink: string | null;
}

export type RecordResult =
  | { readonly status: "recorded" }
  | {
      readonly status: "invalid";
      readonly fields: PaymentErrors;
      readonly message: string | null;
    }
  | { readonly status: "forbidden" }
  | { readonly status: "failed"; readonly message: string };

export interface PaymentService {
  /** A fresh id for a new form. */
  newRequestId(): string;
  load(memberId: string): Promise<SetupResult>;
  preview(memberId: string, amount: number): Promise<PreviewResult>;
  record(payment: NewPayment): Promise<RecordResult>;
}

export const MEMBER_MISSING_MESSAGE = "We could not find this customer.";
export const PREVIEW_FAILED_MESSAGE = "We could not preview this payment.";
export const RECORD_FAILED_MESSAGE = "We could not record this payment. Try again.";

const setupQuery = (id: string) =>
  query("PaymentSetup", {
    member: {
      args: { id },
      select: { name: true, balanceDue: true, paidThrough: true, credit: true },
    },
    tenant: { select: { currency: true, timezone: true } },
  });

const previewQuery = (memberId: string, amount: number) =>
  query("PreviewPayment", {
    previewPayment: {
      args: { memberId, amount },
      select: { allocations: { invoiceId: true }, paidThroughAfter: true, creditAfter: true },
    },
  });

const recordMutation = (payment: NewPayment) =>
  mutation("RecordPayment", {
    recordPayment: {
      args: {
        input: {
          clientRequestId: payment.clientRequestId,
          memberId: payment.memberId,
          amount: payment.amount,
          method: payment.method,
          paidOn: payment.paidOn,
          ...(payment.proofLink === null ? {} : { proofLink: payment.proofLink }),
        },
      },
      select: {
        payment: { id: true },
        errors: { code: true, field: true, message: true },
      },
    },
  });

const FIELD_OF: Readonly<Record<string, keyof PaymentErrors>> = {
  amount: "amount",
  paidOn: "paidOn",
  proofLink: "proofLink",
};

export function createPaymentService(deps: {
  readonly client: Pick<Client, "execute">;
  readonly newRequestId: () => string;
}): PaymentService {
  const { client } = deps;
  return {
    newRequestId: deps.newRequestId,

    async load(memberId) {
      const outcome = await client.execute(setupQuery(memberId));
      if (outcome.status === "network") return { status: "failed", message: outcome.message };
      if (outcome.status === "error") return { status: "failed", message: outcome.error.message };
      if (outcome.status === "empty") return { status: "failed", message: MEMBER_MISSING_MESSAGE };
      const { member, tenant } = outcome.data;
      if (member === null || member === undefined) {
        return { status: "failed", message: MEMBER_MISSING_MESSAGE };
      }
      return {
        status: "ready",
        setup: {
          memberName: member.name ?? null,
          balanceDue: member.balanceDue,
          paidThrough: member.paidThrough ?? null,
          credit: member.credit,
          currency: tenant.currency,
          timezone: tenant.timezone,
        },
      };
    },

    async preview(memberId, amount) {
      const outcome = await client.execute(previewQuery(memberId, amount));
      if (outcome.status === "network") return { status: "failed", message: outcome.message };
      if (outcome.status === "error") return { status: "failed", message: outcome.error.message };
      if (outcome.status === "empty") return { status: "failed", message: PREVIEW_FAILED_MESSAGE };
      const result = outcome.data.previewPayment;
      return {
        status: "preview",
        preview: {
          invoicesCovered: result.allocations.length,
          paidThroughAfter: result.paidThroughAfter ?? null,
          creditAfter: result.creditAfter,
        },
      };
    },

    async record(payment) {
      const outcome = await client.execute(recordMutation(payment));
      if (outcome.status === "network") return { status: "failed", message: outcome.message };
      if (outcome.status === "error") {
        return outcome.error.code === "FORBIDDEN"
          ? { status: "forbidden" }
          : { status: "failed", message: outcome.error.message };
      }
      if (outcome.status === "empty") return { status: "failed", message: RECORD_FAILED_MESSAGE };
      const { payment: recorded, errors } = outcome.data.recordPayment;
      if (errors.some((error) => error.code === "FORBIDDEN")) return { status: "forbidden" };
      if (errors.length === 0) {
        return recorded === null || recorded === undefined
          ? { status: "failed", message: RECORD_FAILED_MESSAGE }
          : { status: "recorded" };
      }
      let fields: PaymentErrors = {};
      let message: string | null = null;
      for (const error of errors) {
        const target = FIELD_OF[error.field ?? ""];
        if (target === undefined) message ??= error.message;
        else fields = { ...fields, [target]: error.message };
      }
      return { status: "invalid", fields, message };
    },
  };
}
