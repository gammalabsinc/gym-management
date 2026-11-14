export const REDACTED = "[redacted]";
export const MAX_DEPTH = 5;

const SENSITIVE_KEY =
  /token|authorization|password|passwd|secret|cookie|session|credential|api[-_]?key|email|barcode/i;

const TEXT_PATTERNS: readonly RegExp[] = [
  /[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g,
];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/** Masks emails, bearer tokens and JWTs that appear inside free text. */
export function redactText(text: string): string {
  return TEXT_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, REDACTED), text);
}

function redactDate(date: Date): string {
  return Number.isNaN(date.getTime()) ? "[invalid date]" : date.toISOString();
}

function redactEntries(entries: [string, unknown][], depth: number): Record<string, unknown> {
  return Object.fromEntries(entries.map(([key, value]) => [key, redactValue(value, depth, key)]));
}

/**
 * Returns a JSON safe copy of any value with secrets masked. Never throws on odd input:
 * depth is capped so cycles end, and errors keep only their name and a scrubbed message,
 * never a stack.
 */
export function redactValue(value: unknown, depth = 0, key?: string): unknown {
  if (value === undefined || value === null) return value;
  if (key !== undefined && isSensitiveKey(key)) return REDACTED;
  switch (typeof value) {
    case "string":
      return redactText(value);
    case "number":
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "function":
      return "[function]";
    case "symbol":
      return "[symbol]";
    default:
      break;
  }
  if (value instanceof Date) return redactDate(value);
  if (value instanceof Error) return { name: value.name, message: redactText(value.message) };
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  return redactEntries(Object.entries(value), depth + 1);
}

export function redactFields(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return redactEntries(Object.entries(fields), 0);
}
