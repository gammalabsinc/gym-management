import { z } from "zod";
import { isCalendarDate } from "../domain/calendar";
import { type FieldIssue, type ValidationError, validationError } from "../domain/errors";
import { type Err, ok, type Result } from "../domain/result";

/** Hard limits applied to every client supplied value before a use case sees it. */
export const LIMITS = {
  id: 64,
  barcode: 64,
  name: 120,
  email: 254,
  phone: 32,
  reason: 500,
  photoRef: 512,
  url: 2048,
  /** A Google ID token is a signed JWT of 1 to 2 kilobytes. */
  idToken: 4096,
  /** GraphQL Int is a signed 32 bit integer. */
  maxInt: 2_147_483_647,
  maxDays: 366,
  maxMinutesInDay: 1440,
} as const;

const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const PHONE_PATTERN = /^[0-9+()\-.\s]+$/;

/** A string trimmed first, so a limit cannot be dodged with padding and blank text is empty. */
export function boundedText(max: number) {
  return z.string().trim().min(1).max(max);
}

export const idSchema = z.string().trim().min(1).max(LIMITS.id).regex(ID_PATTERN, "Invalid id");
export const emailSchema = z.string().trim().toLowerCase().max(LIMITS.email).pipe(z.email());
export const phoneSchema = z
  .string()
  .trim()
  .min(3)
  .max(LIMITS.phone)
  .regex(PHONE_PATTERN, "Invalid phone number");
export const dateSchema = z.string().refine(isCalendarDate, "Must be a real date as YYYY-MM-DD");
export const urlSchema = z.httpUrl().max(LIMITS.url);

/** Money is an integer in minor units. Zero is allowed, negative is not. */
export const minorUnitsSchema = z.number().int().min(0).max(LIMITS.maxInt);
/** For amounts that must buy something: a payment or a discount. */
export const positiveMinorUnitsSchema = z.number().int().min(1).max(LIMITS.maxInt);

/** Optional input where a client may send null or leave the field out. Both mean absent. */
export function optional<T extends z.ZodType>(schema: T) {
  return schema.nullish().transform((value) => value ?? undefined);
}

function fieldIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.filter((part): part is string | number => typeof part !== "symbol"),
    message: issue.message,
  }));
}

/** The shared helper: untrusted input in, typed value or a validation error out. Never throws. */
export function parseInput<S extends z.ZodType>(
  schema: S,
  raw: unknown,
): Result<z.output<S>, ValidationError> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return ok(parsed.data);
  return validationError("Invalid input", fieldIssues(parsed.error));
}

/**
 * Wraps a use case so it only runs on valid input. Invalid input returns the validation
 * error and the use case is never called.
 */
export function guarded<S extends z.ZodType, R>(
  schema: S,
  useCase: (input: z.output<S>) => R | Promise<R>,
): (raw: unknown) => Promise<R | Err<ValidationError>> {
  return async (raw) => {
    const parsed = parseInput(schema, raw);
    return parsed.ok ? useCase(parsed.value) : parsed;
  };
}
