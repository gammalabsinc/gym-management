import type {
  Discount,
  ErrorCode,
  Gym,
  Invoice,
  InvoicePage,
  Me,
  Member,
  MemberPage,
  MembershipPeriod,
  Payment,
  PaymentPage,
  PaymentPreview,
  Plan,
  ReferralSide,
  ScanPayload,
  StaffUser,
  Tenant,
  UserError,
  Visit,
  VisitPage,
} from "@gym/graphql-schema";
import { GraphQLError } from "graphql";
import type { AddedDiscount, EndedDiscount } from "../app/manual-discounts";
import type { DiscountView, InvoiceView, LedgerPage } from "../app/member-ledger";
import type { MemberPage as MemberPageResult } from "../app/member-queries";
import type { AttendanceRecord, LedgerPaymentRow, LedgerPeriodRow } from "../app/ports";
import type { PaymentPreview as PaymentPreviewResult } from "../app/preview-payment";
import type { RecordedPayment } from "../app/record-payment";
import type { RecognizedScan } from "../app/record-scan";
import { LAST_OWNER_MESSAGE, type StaffMember } from "../app/role-management";
import type { TenantView } from "../app/tenant-settings";
import {
  ALREADY_VOID_MESSAGE,
  HAS_ALLOCATIONS_MESSAGE,
  type VoidedInvoice,
  type VoidedPayment,
} from "../app/voids";
import type { Me as MeRecord } from "../app/who-am-i";
import type { DomainError, DomainErrorKind } from "../domain/errors";
import type { GymSummary } from "../domain/gym-picker";
import type { MemberView } from "../domain/member-view";
import type { Role } from "../domain/permissions";
import type { Plan as PlanRecord } from "../domain/plans";
import { ERROR_CODE_BY_KIND } from "./errors";

type GqlRole = Gym["roles"][number];

export function toGqlRole(role: Role): GqlRole {
  return role.toUpperCase() as GqlRole;
}

export function toGqlGym(gym: GymSummary): Gym {
  return {
    tenantId: gym.tenantId,
    name: gym.name,
    logoUrl: gym.logoUrl,
    roles: gym.roles.map(toGqlRole),
  };
}

export function toGqlMe(me: MeRecord): Me {
  return {
    userId: me.userId,
    name: me.name,
    email: me.email,
    roles: me.roles.map(toGqlRole),
    permissions: [...me.permissions],
    memberId: me.memberId,
  };
}

/**
 * A member sees the name, the colour and the contacts of the gym only, so the fields of the full
 * profile are left out of what they get. A member who selects one of those fields gets a GraphQL
 * error for that field, which is the intended refusal.
 */
export function toGqlTenant(view: TenantView): Tenant {
  return view.tenant as unknown as Tenant;
}

const USER_ERROR_CODE: Readonly<Record<DomainErrorKind, ErrorCode>> = {
  validation: "INVALID_INPUT",
  unauthenticated: "FORBIDDEN",
  forbidden: "FORBIDDEN",
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
};

/** The conflicts the app tells apart by their own code, found by the message that is written for them. */
const CONFLICT_CODE_BY_MESSAGE: Readonly<Record<string, ErrorCode>> = {
  [ALREADY_VOID_MESSAGE]: "ALREADY_VOID",
  [HAS_ALLOCATIONS_MESSAGE]: "HAS_ALLOCATIONS",
  [LAST_OWNER_MESSAGE]: "LAST_OWNER",
};

function codeOf(error: DomainError): ErrorCode {
  return error.kind === "conflict"
    ? (CONFLICT_CODE_BY_MESSAGE[error.message] ?? "CONFLICT")
    : USER_ERROR_CODE[error.kind];
}

/**
 * A domain error as the `errors` list of a mutation payload. The field is the last name of the
 * issue's path, so `input.email` is `email`, and `rename` maps the domain's own names to the
 * names of the GraphQL input (the domain says `fullName` where the schema says `name`).
 */
export function toUserErrors(
  error: DomainError,
  rename: Readonly<Record<string, string>> = {},
): UserError[] {
  const issues = error.kind === "validation" ? error.issues : [];
  const code = codeOf(error);
  if (issues.length === 0) return [{ code, field: null, message: error.message }];
  return issues.map((issue) => {
    const name = issue.path.at(-1);
    const field = name === undefined ? null : (rename[String(name)] ?? String(name));
    return { code, field, message: issue.message };
  });
}

/** A domain error thrown out of a query, with the same codes the error mapper uses. */
export function toGraphQLError(error: DomainError): GraphQLError {
  return new GraphQLError(error.message, {
    extensions: { code: ERROR_CODE_BY_KIND[error.kind] },
  });
}

export function toGqlPlan(plan: PlanRecord): Plan {
  return {
    id: plan.id,
    key: plan.key,
    name: plan.name,
    admissionFee: plan.admissionFee,
    monthlyFee: plan.monthlyFee,
    isActive: plan.isActive,
  };
}

/** The id of the member who referred each mapped member, for the field that loads the referrer. */
const referrerIds = new WeakMap<object, string>();

export function referrerIdOf(member: Member): string | null {
  return referrerIds.get(member) ?? null;
}

export function toGqlMember(view: MemberView): Member {
  const member: Member = {
    id: view.id,
    memberNo: view.memberNo,
    barcode: view.barcode,
    name: view.name,
    email: view.email,
    phone: view.phone,
    photoRef: view.photoRef,
    status: view.status.toUpperCase() as Member["status"],
    plan: toGqlPlan(view.plan),
    joinedOn: view.joinedOn,
    leftOn: view.leftOn,
    billingDay: view.billingDay,
    paidThrough: view.paidThrough,
    standing: view.standing.toUpperCase() as Member["standing"],
    balanceDue: view.balanceDue,
    credit: view.credit,
    visitsThisMonth: view.visitsThisMonth,
    visitsLastMonth: view.visitsLastMonth,
    totalPaid: view.totalPaid,
  };
  if (view.referredBy !== null) referrerIds.set(member, view.referredBy);
  return member;
}

export function toGqlMemberPage(page: MemberPageResult): MemberPage {
  return { items: page.items.map(toGqlMember), nextCursor: page.nextCursor };
}

/**
 * The read side does not hold every field of every type (an invoice line has no id, a payment
 * does not know the ids of its allocations). Those fields are left out of what is returned, so a
 * query that selects one fails with a GraphQL error for that field and a value is never invented.
 */
function leaveOut<T>(value: Partial<T>): T {
  return value as T;
}

export function toGqlInvoice(memberId: string, row: InvoiceView): Invoice {
  return leaveOut<Invoice>({
    id: row.id,
    memberId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    dueDate: row.dueDate,
    total: row.total,
    amountDue: row.amountOwing,
    isPaid: row.status === "paid",
    isVoid: row.isVoid,
    voidReason: row.voidReason,
    lines: row.lines.map((line) =>
      leaveOut<Invoice["lines"][number]>({
        lineType: line.type.toUpperCase() as Invoice["lines"][number]["lineType"],
        description: line.description,
        amount: line.amount,
      }),
    ),
  });
}

export function toGqlPayment(memberId: string, row: LedgerPaymentRow): Payment {
  return leaveOut<Payment>({
    id: row.id,
    memberId,
    amount: row.amount,
    method: row.method.toUpperCase() as Payment["method"],
    paidOn: row.paidOn,
    submittedAt: row.recordedAt,
    isVoid: row.isVoid,
    voidReason: row.voidReason,
  });
}

export function toGqlDiscount(memberId: string, row: DiscountView): Discount {
  return leaveOut<Discount>({
    id: row.id,
    memberId,
    kind: row.kind.toUpperCase() as Discount["kind"],
    referralSide: (row.referralSide?.toUpperCase() ?? null) as ReferralSide | null,
    amount: row.amount,
    isRecurring: row.isRecurring,
    reason: row.reason,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    isConsumed: row.status === "consumed",
    isActive: row.status === "active",
  });
}

export function toGqlPeriod(memberId: string, row: LedgerPeriodRow): MembershipPeriod {
  return leaveOut<MembershipPeriod>({
    id: row.id,
    memberId,
    planId: row.planId,
    status: row.status.toUpperCase() as MembershipPeriod["status"],
    validFrom: row.validFrom,
    validTo: row.validTo,
    reason: row.reason,
  });
}

export function toGqlVisit(row: AttendanceRecord): Visit {
  return {
    id: row.id,
    memberId: row.memberId,
    scannedAt: row.scannedAt,
    localDate: row.localDate,
    isDuplicate: row.isDuplicate,
    statusAtScan: row.statusAtScan.toUpperCase() as Visit["statusAtScan"],
    source: row.source.toUpperCase() as Visit["source"],
  };
}

export function toGqlPage<Row, Item>(
  page: LedgerPage<Row>,
  toItem: (row: Row) => Item,
): { items: Item[]; nextCursor: string | null } {
  return { items: page.items.map(toItem), nextCursor: page.nextCursor };
}

export type { InvoicePage, PaymentPage, VisitPage };

/**
 * A payment can cover a cycle whose invoice is not built yet. The preview still counts it, with
 * the id `upcoming:` and the first day of the cycle, which no real invoice id can look like.
 */
export function toGqlPreview(preview: PaymentPreviewResult): PaymentPreview {
  return {
    allocations: preview.allocations.map((allocation) => ({
      invoiceId: allocation.invoiceId ?? `upcoming:${allocation.periodStart}`,
      amount: allocation.amount,
    })),
    paidThroughAfter: preview.paidThroughAfter,
    creditAfter: preview.creditAfter,
  };
}

export function toGqlRecordedPayment(payment: RecordedPayment): Payment {
  return {
    id: payment.id,
    memberId: payment.memberId,
    amount: payment.amount,
    method: payment.method.toUpperCase() as Payment["method"],
    paidOn: payment.paidOn,
    submittedAt: payment.submittedAt,
    proofLink: payment.proofLink,
    recordedBy: payment.recordedBy,
    isVoid: payment.isVoid,
    voidReason: payment.voidReason,
    allocations: payment.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })),
  };
}

export function toGqlVoidedPayment(payment: VoidedPayment): Payment {
  return leaveOut<Payment>({
    id: payment.id,
    memberId: payment.memberId,
    amount: payment.amount,
    isVoid: true,
    voidReason: payment.reason,
  });
}

export function toGqlVoidedInvoice(invoice: VoidedInvoice): Invoice {
  return leaveOut<Invoice>({
    id: invoice.id,
    memberId: invoice.memberId,
    isVoid: true,
    voidReason: invoice.reason,
  });
}

export function toGqlStaff(user: StaffMember): StaffUser {
  return {
    userId: user.userId,
    name: user.name,
    email: user.email,
    roles: user.roles.map(toGqlRole),
    hasSignedIn: user.hasSignedIn,
  };
}

export function toGqlAddedDiscount(discount: AddedDiscount): Discount {
  return leaveOut<Discount>({
    id: discount.id,
    memberId: discount.memberId,
    kind: "MANUAL",
    amount: discount.amount,
    isRecurring: discount.isRecurring,
    startsOn: discount.startsOn,
    isActive: true,
    isConsumed: false,
  });
}

export function toGqlEndedDiscount(discount: EndedDiscount): Discount {
  return leaveOut<Discount>({
    id: discount.id,
    memberId: discount.memberId,
    endsOn: discount.endsOn,
  });
}

export function toGqlScan(scan: RecognizedScan): Pick<ScanPayload, "visit" | "member"> {
  const { visit, member } = scan;
  return {
    visit: {
      id: visit.id,
      memberId: visit.memberId,
      scannedAt: visit.scannedAt,
      localDate: visit.localDate,
      isDuplicate: visit.isDuplicate,
      statusAtScan: visit.statusAtScan.toUpperCase() as Visit["statusAtScan"],
      source: visit.source.toUpperCase() as Visit["source"],
    },
    member: leaveOut<Member>({
      id: member.id,
      name: member.name,
      standing: member.standing.toUpperCase() as Member["standing"],
      paidThrough: member.paidThrough,
      status: member.status.toUpperCase() as Member["status"],
      leftOn: member.status === "cancelled" ? member.statusChangedOn : null,
    }),
  };
}
