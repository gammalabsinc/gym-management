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

export interface GoogleUser {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly name: string | null;
}

/** Looks a Google account up by its subject id and keeps the user row in step with it. */
export interface GoogleUserDirectory {
  /** Matches on the subject, never on the email. A changed email updates the same user. */
  upsertBySubject(
    tenantId: string,
    identity: { readonly subject: string; readonly email: string; readonly name: string | null },
  ): Promise<GoogleUser>;
}
