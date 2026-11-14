import type { LogLevel } from "../app/config";
import type {
  Clock,
  LogContext,
  LogFields,
  Logger,
  LogMethod,
  UnexpectedErrorReporter,
} from "../app/ports";
import { redactFields, redactText } from "../domain/redact";

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerDeps {
  readonly clock: Clock;
  /** Receives one JSON document per call, without a trailing newline. */
  readonly write: (line: string) => void;
  readonly level: LogLevel;
}

function definedContext(context: LogContext): LogContext {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => typeof value === "string" && value !== ""),
  );
}

function mergeContext(parent: LogContext, child: LogContext): LogContext {
  const merged = { ...parent, ...definedContext(child) };
  return parent.requestId === undefined ? merged : { ...merged, requestId: parent.requestId };
}

/** Context and the fixed keys win. A clashing field is kept under a field_ prefix, not lost. */
function buildLine(base: Record<string, unknown>, fields: LogFields): Record<string, unknown> {
  const line = { ...base };
  for (const [key, value] of Object.entries(redactFields(fields))) {
    line[Object.hasOwn(base, key) ? `field_${key}` : key] = value;
  }
  return line;
}

export function makeLogger(deps: LoggerDeps, context: LogContext = {}): Logger {
  const method =
    (level: LogLevel): LogMethod =>
    (message, fields = {}) => {
      if (LEVEL_RANK[level] < LEVEL_RANK[deps.level]) return;
      const base = {
        time: deps.clock.now().toISOString(),
        level,
        msg: redactText(message),
        ...definedContext(context),
      };
      deps.write(JSON.stringify(buildLine(base, fields)));
    };
  return {
    debug: method("debug"),
    info: method("info"),
    warn: method("warn"),
    error: method("error"),
    child: (extra) => makeLogger(deps, mergeContext(context, extra)),
  };
}

/** Sends the original cause of an unexpected error to the log under the id the client saw. */
export function makeLoggingReporter(logger: Logger): UnexpectedErrorReporter {
  return (cause, requestId) =>
    logger.child({ requestId }).error("unexpected error", { error: cause });
}
