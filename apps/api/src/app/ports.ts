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
