import type { DateText } from "../domain/billing-cycle";
import type { Discount } from "../domain/discounts";
import type { GymSummary } from "../domain/gym-picker";
import type { InvoiceDraft } from "../domain/invoice-build";
import type { MemberCursor } from "../domain/member-list";
import type { MemberListRow, MemberView } from "../domain/member-view";
import type {
  Allocation,
  LedgerInvoice,
  NewPayment,
  PaymentMethod,
  UnpaidInvoice,
} from "../domain/payment";
import type { Role } from "../domain/permissions";
import type { NewPlan, Plan, PlanFields } from "../domain/plans";
import type { NewReferralDiscount } from "../domain/referral";
import type { ScanSource } from "../domain/scan";
import type { MembershipStatus, Standing } from "../domain/standing";
import type { Tenant, TenantSettings } from "../domain/tenant";
import type { SpareCredit } from "../domain/voids";

export interface Clock {
  now(): Date;
}

/** Receives the original cause of an unexpected error, with the request id the client was given. */
export type UnexpectedErrorReporter = (cause: unknown, requestId: string) => void;

export interface IdGenerator {
  next(): string;
}

/** Correlation fields that every log line of a request carries. */
export interface LogContext {
  readonly requestId?: string;
  readonly tenantId?: string;
  readonly userId?: string;
}

export type LogFields = Readonly<Record<string, unknown>>;

export type LogMethod = (message: string, fields?: LogFields) => void;

export interface Logger {
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  /** Adds context. A request id that is already set is never replaced. */
  child(context: LogContext): Logger;
}

/**
 * Runs `fn` in a transaction scoped to one tenant. `Tx` is whatever handle the adapter hands out;
 * the app layer never looks inside it.
 */
export type WithTenantTx<Tx> = <T>(tenantId: string, fn: (tx: Tx) => Promise<T>) => Promise<T>;

/** The row before or after a change, as plain data. */
export type AuditSnapshot = Readonly<Record<string, unknown>>;

/** What a use case reports about one change. The tenant comes from the transaction, not from here. */
export interface AuditEvent {
  /** Null for system jobs. */
  readonly actorUserId: string | null;
  /** A key such as payment.recorded or role.assigned. */
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  /** Null where there was no earlier row. */
  readonly before: AuditSnapshot | null;
  /** Null where nothing is left afterwards. */
  readonly after: AuditSnapshot | null;
  /** Ties the event to one API request. */
  readonly requestId: string;
}

/**
 * Called inside the use case transaction, so the event commits or rolls back with the change it
 * describes. An invalid event is a bug and throws, which rolls the whole change back.
 */
export interface AuditLog {
  record(event: AuditEvent): Promise<void>;
}

/** One gym a Google account has a row in. Names and roles are read where they are needed. */
export interface GymAccount {
  readonly userId: string;
  readonly tenantId: string;
}

/**
 * Members and staff are added by Google email before they ever sign in, so a sign in never
 * creates a user. It links the Google subject to the rows that were waiting for that email.
 */
export interface AccountDirectory {
  /**
   * Links the subject to every unlinked user row with this email, in every gym, then returns
   * all rows the subject now holds. A row already linked to a subject is never taken over, and
   * an email with no rows returns an empty list. After a row is linked, the subject is the
   * identity and the email on the row is only a label.
   */
  claim(identity: {
    readonly subject: string;
    readonly email: string;
  }): Promise<readonly GymAccount[]>;
}

/** A session row as the store hands it back. The token hash never leaves the store. */
export interface StoredSession {
  readonly id: string;
  readonly subject: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  /** The gym the session is bound to. Null for an identity session that has not picked one. */
  readonly gymId: string | null;
}

export interface NewSession {
  readonly id: string;
  readonly tokenHash: string;
  readonly subject: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
}

/** Sessions are keyed by the hash of their token, so a copy of the table holds no usable token. */
export interface SessionStore {
  insert(session: NewSession): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<StoredSession | null>;
  /** Marks the session revoked. Revoking an unknown or already revoked session changes nothing. */
  revokeByTokenHash(tokenHash: string, at: Date): Promise<void>;
  /** Revokes every live session of one person. Returns how many were revoked. */
  revokeAllForSubject(subject: string, at: Date): Promise<number>;
  /** Binds a live session to a gym, replacing an earlier gym. A revoked session is left alone. */
  bindGym(sessionId: string, gymId: string): Promise<void>;
}

/** Tells whether a gym exists and is switched on. The tenants table is not tenant scoped. */
export interface GymRegistry {
  isActive(gymId: string): Promise<boolean>;
}

/** Makes session tokens and turns a presented token into the value the store is keyed by. */
export interface SessionTokens {
  /** A fresh unguessable token, and the hash to store for it. */
  generate(): { readonly token: string; readonly tokenHash: string };
  hash(token: string): string;
}

/** One user of a gym as the staff directory stores it. */
export interface StaffRecord {
  readonly userId: string;
  readonly name: string | null;
  readonly email: string;
  /** Every role the user holds in this gym, in alphabetical order. */
  readonly roles: readonly Role[];
  /** Null until the person has signed in with Google. */
  readonly authSubject: string | null;
}

/**
 * The users and roles of one gym. It belongs to a tenant transaction, so it only ever sees that
 * gym's rows.
 */
export interface StaffDirectory {
  /** The users who hold the owner or staff role, ordered by email. */
  list(): Promise<readonly StaffRecord[]>;
  find(userId: string): Promise<StaffRecord | null>;
  /** The email is lower case. */
  findByEmail(email: string): Promise<StaffRecord | null>;
  /**
   * The ids of every owner. The rows stay locked until the transaction ends, so two requests
   * that each demote a different owner cannot both pass the last owner check.
   */
  lockOwners(): Promise<readonly string[]>;
  /** Returns the new user id, or null when someone added the same email in the meantime. */
  createUser(user: {
    readonly email: string;
    readonly name: string | null;
    readonly phone?: string | null | undefined;
  }): Promise<string | null>;
  /** Returns false when the user already held the role. */
  addRole(userId: string, role: Role): Promise<boolean>;
  /** Returns false when the user did not hold the role. */
  removeRole(userId: string, role: Role): Promise<boolean>;
}

/** Everything one role management use case needs, all inside one tenant transaction. */
export interface StaffUnit {
  readonly staff: StaffDirectory;
  readonly audit: AuditLog;
  readonly sessions: Pick<SessionStore, "revokeAllForSubject">;
}

/** The plans of one gym. It belongs to a tenant transaction, so it only ever sees that gym's rows. */
export interface PlanStore {
  /** Every plan, archived ones included, so a member's old plan still reads. Ordered by key. */
  list(): Promise<readonly Plan[]>;
  findByKey(key: string): Promise<Plan | null>;
  /** The plan, locked until the transaction ends so the old values an audit event records are true. */
  findForUpdate(id: string): Promise<Plan | null>;
  update(id: string, fields: PlanFields): Promise<void>;
  /** Returns the new plan, or null when the gym already has a plan under that key. */
  insertIfAbsent(plan: NewPlan): Promise<Plan | null>;
}

/** Everything one plan use case needs, all inside one tenant transaction. */
export interface PlanUnit {
  readonly plans: PlanStore;
  readonly audit: AuditLog;
}

/** The gym's own row: its profile and its settings. */
export interface TenantStore {
  find(): Promise<Tenant | null>;
  /** Locked until the transaction ends, so two owners editing at once cannot lose an update. */
  findForUpdate(): Promise<Tenant | null>;
  /** Merges these keys into the settings column and leaves every other key as it is. */
  mergeSettings(json: Readonly<Record<string, number | boolean>>): Promise<void>;
}

/** Everything the profile and settings use cases need, all inside one tenant transaction. */
export interface SettingsUnit {
  readonly tenants: TenantStore;
  readonly plans: PlanStore;
  readonly audit: AuditLog;
}

/** What invoice generation reads about a member: the billing day and the current period row. */
export interface BillableMember {
  readonly id: string;
  /** Day of the month each cycle starts, 1 to 31. */
  readonly billingDay: number;
  /** Status and plan of the member's current period. */
  readonly status: MembershipStatus;
  readonly planId: string;
  /** First day of the member's current stretch of active membership. */
  readonly activeFrom: DateText;
}

export interface PlanFees {
  readonly admissionFee: number;
  readonly monthlyFee: number;
}

/** The invoices of one gym. It belongs to a tenant transaction, so it only ever sees that gym's rows. */
export interface InvoiceStore {
  /**
   * The member with the current period, locked until the transaction ends, so two runs for one
   * member take turns. Null when the gym has no such member.
   */
  lockMember(memberId: string): Promise<BillableMember | null>;
  findPlanFees(planId: string): Promise<PlanFees | null>;
  /** The latest `period_end` over every invoice of the member, void ones included, or null. */
  lastPeriodEnd(memberId: string): Promise<DateText | null>;
  /** Every active discount row of the member. The domain decides which of them apply. */
  discountsOf(memberId: string): Promise<readonly Discount[]>;
  /**
   * Writes the invoice and its lines. Returns the new id, or null when the member already has a
   * live invoice for that cycle, in which case nothing is written.
   */
  insert(memberId: string, draft: InvoiceDraft): Promise<string | null>;
  /** Marks one time discounts as used by an invoice, so they never land on another. */
  markConsumed(discountIds: readonly string[], invoiceId: string): Promise<void>;
}

/** Everything invoice generation needs, all inside one tenant transaction. */
export interface InvoiceUnit {
  readonly invoices: InvoiceStore;
  readonly tenants: Pick<TenantStore, "find">;
  readonly audit: AuditLog;
}

/**
 * Reads the gym rows a Google account already holds. It never links a row, so it is safe to call
 * on any request that carries a session, unlike `AccountDirectory.claim`.
 */
export interface AccountLookup {
  /** The active user rows linked to this subject, one per gym, ordered by gym id. */
  gymsOf(subject: string): Promise<readonly GymAccount[]>;
}

/** The gym picker's view of one gym, for one user. It belongs to a tenant transaction. */
export interface GymPickerStore {
  /**
   * The gym with this user's roles in it. Null when the user holds no role there, the user row
   * is switched off, or the gym is switched off.
   */
  find(userId: string): Promise<GymSummary | null>;
}

export interface GymPickerUnit {
  readonly gyms: GymPickerStore;
}

/** A gym row to insert. The id is chosen by the caller, so the transaction can be scoped to it. */
export interface NewGymRow {
  readonly id: string;
  readonly name: string;
  readonly subdomain: string;
  readonly timezone: string;
  readonly currency: string;
  readonly settings: TenantSettings;
}

/** Adds gyms. The tenants table is not tenant scoped, because a gym is the row itself. */
export interface GymProvisioner {
  /** Returns false, writing nothing, when a gym already has that subdomain. */
  insertIfAbsent(gym: NewGymRow): Promise<boolean>;
  findIdBySubdomain(subdomain: string): Promise<string | null>;
}

/** Everything adding a gym needs, all inside one transaction scoped to the new gym's id. */
export interface OnboardUnit {
  readonly gyms: GymProvisioner;
  readonly staff: Pick<StaffDirectory, "createUser" | "addRole">;
  readonly plans: PlanStore;
  readonly audit: AuditLog;
}

/** Makes the six character codes a member gets. The database decides whether a code is free. */
export interface CodeGenerator {
  next(): string;
}

export interface NewMemberRow {
  readonly userId: string;
  readonly memberNo: string;
  readonly barcode: string;
  readonly billingDay: number;
  readonly referredBy: string | null;
}

export interface NewMembershipPeriod {
  readonly memberId: string;
  readonly planId: string;
  /** The gym's local date the membership starts. */
  readonly validFrom: string;
  readonly changedBy: string;
}

/** The members of one gym. It belongs to a tenant transaction, so it only ever sees that gym's rows. */
export interface MemberStore {
  /** The id of the member row of this user, or null when the user is not a member. */
  findIdByUser(userId: string): Promise<string | null>;
  exists(memberId: string): Promise<boolean>;
  /**
   * Returns the new member id. Returns null, writing nothing, when the member number or the
   * barcode is taken by any gym, or when the user already has a member row.
   */
  insertIfAbsent(row: NewMemberRow): Promise<string | null>;
  /** Opens the first, active period of a member, with no end. */
  openPeriod(period: NewMembershipPeriod): Promise<void>;
}

/** Everything creating a member needs, all inside one tenant transaction. */
export interface MemberUnit {
  readonly members: MemberStore;
  readonly staff: Pick<StaffDirectory, "findByEmail" | "createUser" | "addRole">;
  readonly plans: Pick<PlanStore, "findByKey">;
  readonly referrals: ReferralStore;
  readonly invoices: InvoiceStore;
  readonly tenants: Pick<TenantStore, "find">;
  readonly audit: AuditLog;
}

/** The current period of a member, as the membership change use cases read it. */
export interface CurrentPeriod {
  readonly id: string;
  readonly planId: string;
  readonly status: MembershipStatus;
  /** The gym's local date the period began, written YYYY-MM-DD. */
  readonly validFrom: string;
}

export interface NextPeriod {
  readonly memberId: string;
  readonly planId: string;
  readonly status: MembershipStatus;
  readonly validFrom: string;
  readonly reason: string;
  readonly changedBy: string;
}

/** The membership periods of one gym. It belongs to a tenant transaction. */
export interface PeriodStore {
  /**
   * The member's current period, with the member row locked until the transaction ends, so two
   * changes for one member take turns. Null when the gym has no such member.
   */
  lockCurrent(memberId: string): Promise<CurrentPeriod | null>;
  /** Closes the period by setting its end date. */
  close(periodId: string, validTo: string): Promise<void>;
  /** Opens the period that follows, with no end. */
  open(period: NextPeriod): Promise<void>;
}

/** Everything pausing, resuming or cancelling a membership needs, in one tenant transaction. */
export interface MembershipUnit {
  readonly periods: PeriodStore;
  readonly tenants: Pick<TenantStore, "find">;
  readonly audit: AuditLog;
}

/** The profile fields of a member that an edit can change. They live on the member's user row. */
export interface MemberProfile {
  readonly userId: string;
  readonly name: string | null;
  readonly phone: string | null;
}

/** The profiles of one gym. It belongs to a tenant transaction. */
export interface ProfileStore {
  /** The member's profile, locked until the transaction ends. Null when the gym has no such member. */
  lock(memberId: string): Promise<MemberProfile | null>;
  update(
    userId: string,
    change: { readonly name?: string; readonly phone?: string | null },
  ): Promise<void>;
}

/** Everything editing a member profile needs, in one tenant transaction. */
export interface ProfileUnit {
  readonly profiles: ProfileStore;
  readonly audit: AuditLog;
}

/** What the member queries need to derive a member's standing and counts. */
export interface MemberQueryContext {
  /** The gym's local date. */
  readonly today: string;
  readonly warnDaysBefore: number;
  readonly redDaysAfter: number;
  /** First day of last month, this month and next month, by the gym's calendar. */
  readonly lastMonthStart: string;
  readonly thisMonthStart: string;
  readonly nextMonthStart: string;
}

export interface MemberPageRequest {
  readonly search: string | null;
  /** Rows to return. The use case asks for one more than the page size to learn if there is a next page. */
  readonly limit: number;
  readonly after: MemberCursor | null;
}

/** Reads members with their derived fields. It belongs to a tenant transaction. */
export interface MemberQueryStore {
  find(memberId: string, context: MemberQueryContext): Promise<MemberView | null>;
  /** Overdue first, then by name, then by id. Rows after the cursor only. */
  list(request: MemberPageRequest, context: MemberQueryContext): Promise<readonly MemberListRow[]>;
}

export interface MemberQueryUnit {
  readonly members: MemberQueryStore;
  readonly tenants: Pick<TenantStore, "find">;
}

/** The gyms a job works through. The tenants table is not tenant scoped. */
export interface TenantRegistry {
  /** Every gym that is switched on, in a fixed order. */
  activeTenantIds(): Promise<readonly string[]>;
}

export type Exclusive<T> = { readonly ran: true; readonly value: T } | { readonly ran: false };

/** Keeps two workers from doing the same job for the same gym at the same time. */
export interface TenantJobLock {
  /**
   * Runs `fn` when no other worker holds this gym's lock, and gives the lock back afterwards,
   * even when `fn` throws. Returns `ran: false` at once, without waiting, when the lock is taken.
   */
  runExclusive<T>(tenantId: string, fn: () => Promise<T>): Promise<Exclusive<T>>;
}

/** Who has an active membership right now, in one gym. It belongs to a tenant transaction. */
export interface MemberRoster {
  activeMemberIds(): Promise<readonly string[]>;
}

/** Everything the daily invoice job needs for one member, all inside one tenant transaction. */
export interface TopUpUnit extends InvoiceUnit {
  readonly roster: MemberRoster;
}

/** A payment the dev seed writes straight away, until the record payment use case exists. */
export interface SeedPaymentRow {
  readonly memberId: string;
  readonly invoiceId: string;
  /** Minor units, the whole invoice. */
  readonly amount: number;
  /** The gym's local date the payment was made. */
  readonly paidOn: string;
  readonly recordedBy: string;
  readonly clientRequestId: string;
}

/** The payments of one gym. It belongs to a tenant transaction. */
export interface SeedPaymentStore {
  /** Writes the payment and the allocation that settles the invoice. Returns the payment id. */
  insertPaid(row: SeedPaymentRow): Promise<string>;
}

export interface SeedPaymentUnit {
  readonly payments: SeedPaymentStore;
  readonly audit: AuditLog;
}

/** A payment as the database holds it, with the invoices it was allocated to. */
export interface StoredPayment {
  readonly id: string;
  readonly memberId: string;
  readonly amount: number;
  readonly method: PaymentMethod;
  /** The gym's local date the money was received, written YYYY-MM-DD. */
  readonly paidOn: string;
  /** When the payment was recorded, an instant in UTC. */
  readonly submittedAt: string;
  readonly proofLink: string | null;
  readonly recordedBy: string;
  readonly isVoid: boolean;
  readonly voidReason: string | null;
  /** Counted or not: the rows the payment wrote, oldest invoice first. */
  readonly allocations: readonly Allocation[];
}

export interface NewPaymentRow extends NewPayment {
  readonly recordedBy: string;
}

/** The payments of one gym. It belongs to a tenant transaction, so it only ever sees that gym's rows. */
export interface PaymentStore {
  /** The payment that carries this request id, or null. The request id is unique per gym. */
  findByRequestId(clientRequestId: string): Promise<StoredPayment | null>;
  /**
   * The member's invoices that are not void and not fully paid, oldest cycle first, with what is
   * still owed. Allocations of a void payment do not count.
   */
  unpaidInvoices(memberId: string): Promise<readonly UnpaidInvoice[]>;
  /**
   * Every invoice of the member that is not void, with what is still owed on it. Allocations of
   * a void payment do not count. Read only, it is what a payment preview starts from.
   */
  ledger(memberId: string): Promise<readonly LedgerInvoice[]>;
  /**
   * Writes the payment. Returns its id and when it was recorded, or null when the request id is
   * already taken, in which case nothing is written.
   */
  insert(row: NewPaymentRow): Promise<{ readonly id: string; readonly submittedAt: string } | null>;
  /** Writes the rows that settle invoices with the payment. */
  insertAllocations(paymentId: string, allocations: readonly Allocation[]): Promise<void>;
}

/** Everything recording a payment needs, all inside one tenant transaction. */
export interface PaymentUnit extends InvoiceUnit {
  readonly payments: PaymentStore;
}

/** A referral discount row to write. */
export interface NewReferralRow extends NewReferralDiscount {
  readonly createdBy: string | null;
}

/** The referral discounts of one gym. It belongs to a tenant transaction. */
export interface ReferralStore {
  /**
   * Who referred the member, as captured when the member was added. Null when nobody did, and
   * undefined when the gym has no such member.
   */
  referrerOf(memberId: string): Promise<string | null | undefined>;
  /** True when a referral between these two members already has discount rows, either way round. */
  exists(memberId: string, referrerId: string): Promise<boolean>;
  /** Writes one row. Returns its id, or null when that exact referral row is already there. */
  insert(row: NewReferralRow): Promise<string | null>;
}

/** The member a barcode belongs to, with the current period the scan card reports. */
export interface ScanMember {
  readonly id: string;
  readonly status: MembershipStatus;
  /** The gym's local date the current period began, written YYYY-MM-DD. */
  readonly statusSince: string;
}

export interface NewAttendanceRow {
  readonly memberId: string;
  readonly scannedAt: Date;
  /** The scan day in the gym's time zone, written YYYY-MM-DD. */
  readonly localDate: string;
  readonly isDuplicate: boolean;
  readonly statusAtScan: Standing;
  readonly source: ScanSource;
}

/** The attendance log of one gym. It belongs to a tenant transaction, so it only ever sees that gym's rows. */
export interface ScanStore {
  /**
   * The member with this barcode in this gym, locked until the transaction ends, so two scans of
   * one member take turns. Null when no member of this gym has the code, whichever gym holds it.
   */
  lockByBarcode(barcode: string): Promise<ScanMember | null>;
  /**
   * When the member's last scan that was not a duplicate happened, as a UTC instant, provided it
   * falls inside the window that ends at `now`. A window of zero minutes holds nothing. Null when
   * there is no such scan.
   */
  originalScanWithin(memberId: string, now: Date, windowMinutes: number): Promise<string | null>;
  /** Writes the scan and returns its id. */
  insert(row: NewAttendanceRow): Promise<string>;
}

/** Everything recording a scan needs, all inside one tenant transaction. A scan writes no audit event. */
export interface ScanUnit {
  readonly scans: ScanStore;
  readonly members: Pick<MemberQueryStore, "find">;
  readonly tenants: Pick<TenantStore, "find">;
}

/** A payment as a void reads it. */
export interface VoidablePayment {
  readonly id: string;
  readonly memberId: string;
  readonly amount: number;
  readonly isVoid: boolean;
  /** Every allocation the payment wrote, oldest invoice first. They stop counting when it is voided. */
  readonly allocations: readonly Allocation[];
}

/** An invoice as a void reads it. */
export interface VoidableInvoice {
  readonly id: string;
  readonly memberId: string;
  readonly isVoid: boolean;
  /** The first day of the cycle, written YYYY-MM-DD. */
  readonly periodStart: string;
  readonly total: number;
  /** The allocations on the invoice that count, which are those of payments that are not void. */
  readonly counted: number;
}

export interface VoidDetails {
  readonly reason: string;
  readonly voidedBy: string;
  readonly voidedAt: Date;
}

/** Voids payments and invoices. It belongs to a tenant transaction, so it only ever sees that gym's rows. */
export interface VoidStore {
  findPayment(paymentId: string): Promise<VoidablePayment | null>;
  findInvoice(invoiceId: string): Promise<VoidableInvoice | null>;
  /** Returns false, changing nothing, when the payment was void already. */
  voidPayment(paymentId: string, details: VoidDetails): Promise<boolean>;
  /** Returns false, changing nothing, when the invoice was void already. */
  voidInvoice(invoiceId: string, details: VoidDetails): Promise<boolean>;
  /**
   * The payments of the member that are not void and have part of their amount unallocated, oldest
   * payment first.
   */
  spareCredits(memberId: string): Promise<readonly SpareCredit[]>;
}

/** Everything voiding needs, all inside one tenant transaction. */
export interface VoidUnit {
  readonly voids: VoidStore;
  readonly payments: Pick<PaymentStore, "unpaidInvoices" | "insertAllocations">;
  readonly invoices: Pick<InvoiceStore, "lockMember">;
  readonly audit: AuditLog;
}
