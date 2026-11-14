import { ZodError } from "zod";
import type { UnexpectedErrorReporter } from "../app/ports";
import {
  type DomainError,
  type DomainErrorKind,
  type FieldIssue,
  isDomainError,
} from "../domain/errors";

export type GraphQLErrorCode =
  | "BAD_USER_INPUT"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INTERNAL_SERVER_ERROR";

export const ERROR_CODE_BY_KIND: Readonly<Record<DomainErrorKind, GraphQLErrorCode>> = {
  validation: "BAD_USER_INPUT",
  unauthenticated: "UNAUTHENTICATED",
  forbidden: "FORBIDDEN",
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
};

export const MASKED_MESSAGE = "Internal error";
export const UNKNOWN_REQUEST_ID = "unknown";

/** The only error shape that leaves the service. No stack, no cause, no raw messages. */
export interface ClientError {
  readonly message: string;
  readonly extensions: {
    readonly code: GraphQLErrorCode;
    readonly requestId: string;
    readonly issues?: readonly FieldIssue[];
  };
}

function zodIssues(error: ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.filter((part): part is string | number => typeof part !== "symbol"),
    message: issue.message,
  }));
}

function fromDomainError(error: DomainError, requestId: string): ClientError {
  const code = ERROR_CODE_BY_KIND[error.kind];
  return error.kind === "validation"
    ? { message: error.message, extensions: { code, requestId, issues: error.issues } }
    : { message: error.message, extensions: { code, requestId } };
}

/**
 * Builds the one mapper from anything thrown or returned to a client error.
 * Known errors keep their code. Everything else becomes a masked internal error, and the
 * original cause goes only to the reporter. The reporter must not throw.
 */
export function makeErrorMapper(
  report: UnexpectedErrorReporter,
): (cause: unknown, requestId: string) => ClientError {
  return (cause, requestId) => {
    const id = requestId.trim() === "" ? UNKNOWN_REQUEST_ID : requestId;
    if (isDomainError(cause)) return fromDomainError(cause, id);
    if (cause instanceof ZodError) {
      return fromDomainError(
        { kind: "validation", message: "Invalid input", issues: zodIssues(cause) },
        id,
      );
    }
    report(cause, id);
    return {
      message: MASKED_MESSAGE,
      extensions: { code: "INTERNAL_SERVER_ERROR", requestId: id },
    };
  };
}
