import { type Err, err } from "./result";

export const DOMAIN_ERROR_KINDS = [
  "validation",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
] as const;

export type DomainErrorKind = (typeof DOMAIN_ERROR_KINDS)[number];

export interface FieldIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

interface BaseError<K extends DomainErrorKind> {
  readonly kind: K;
  /** Written by us and safe to show to a client. Never built from caught exceptions. */
  readonly message: string;
}

export interface ValidationError extends BaseError<"validation"> {
  readonly issues: readonly FieldIssue[];
}
export type UnauthenticatedError = BaseError<"unauthenticated">;
export type ForbiddenError = BaseError<"forbidden">;
export type NotFoundError = BaseError<"not_found">;
export type ConflictError = BaseError<"conflict">;

export type DomainError =
  | ValidationError
  | UnauthenticatedError
  | ForbiddenError
  | NotFoundError
  | ConflictError;

export function validationError(
  message: string,
  issues: readonly FieldIssue[] = [],
): Err<ValidationError> {
  return err({ kind: "validation", message, issues });
}

export function unauthenticated(message = "Sign in required"): Err<UnauthenticatedError> {
  return err({ kind: "unauthenticated", message });
}

export function forbidden(message = "Not allowed"): Err<ForbiddenError> {
  return err({ kind: "forbidden", message });
}

export function notFound(message = "Not found"): Err<NotFoundError> {
  return err({ kind: "not_found", message });
}

export function conflict(message: string): Err<ConflictError> {
  return err({ kind: "conflict", message });
}

export function isDomainError(value: unknown): value is DomainError {
  if (typeof value !== "object" || value === null) return false;
  const { kind, message } = value as { kind?: unknown; message?: unknown };
  return (
    typeof message === "string" &&
    typeof kind === "string" &&
    (DOMAIN_ERROR_KINDS as readonly string[]).includes(kind)
  );
}
