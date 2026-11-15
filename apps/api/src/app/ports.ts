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
