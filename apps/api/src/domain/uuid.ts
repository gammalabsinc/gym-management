import { type ValidationError, validationError } from "./errors";
import { ok, type Result } from "./result";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Boundary check for an id that is used in a uuid column. A bad id is refused, never cast. */
export function parseUuid(raw: string, field: string): Result<string, ValidationError> {
  const id = raw.trim();
  return UUID_PATTERN.test(id)
    ? ok(id.toLowerCase())
    : validationError(`Invalid ${field}`, [{ path: [field], message: "Invalid id" }]);
}
