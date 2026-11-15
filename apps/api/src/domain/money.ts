import { type ValidationError, validationError } from "./errors";
import { andThen, ok, type Result } from "./result";

/** Money is a whole number of minor units (cents). Never a float. Discount lines are negative. */
export type MinorUnits = number;

export function isMinorUnits(value: unknown): value is MinorUnits {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** Boundary check for an amount that arrives from outside the domain. */
export function minorUnits(value: unknown, field = "amount"): Result<MinorUnits, ValidationError> {
  if (isMinorUnits(value)) return ok(value);
  return validationError(`${field} must be a whole number of minor units`, [
    { path: [field], message: "must be a whole number of minor units" },
  ]);
}

export function addMinor(a: MinorUnits, b: MinorUnits): Result<MinorUnits, ValidationError> {
  return minorUnits(a + b, "sum");
}

export function subtractMinor(a: MinorUnits, b: MinorUnits): Result<MinorUnits, ValidationError> {
  return minorUnits(a - b, "difference");
}

export function sumMinor(values: readonly MinorUnits[]): Result<MinorUnits, ValidationError> {
  return values.reduce<Result<MinorUnits, ValidationError>>(
    (total, value) => andThen(total, (running) => addMinor(running, value)),
    ok(0),
  );
}
