import type { DateText } from "../domain/billing-cycle";
import type { Discount } from "../domain/discounts";
import type { GymSummary } from "../domain/gym-picker";
import type { InvoiceDraft } from "../domain/invoice-build";
import type { Role } from "../domain/permissions";
import type { NewPlan, Plan, PlanFields } from "../domain/plans";
import type { MembershipStatus } from "../domain/standing";
import type { Tenant } from "../domain/tenant";

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
