export interface FieldIssue {
  readonly field: string;
  readonly message: string;
}

/** An error the API reported, reduced to what a screen may show. Raw server text is never kept. */
export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly requestId: string | null;
  readonly issues: readonly FieldIssue[];
}

const MESSAGES: Readonly<Record<string, string>> = {
  BAD_USER_INPUT: "Some of the details are not valid. Check them and try again.",
  UNAUTHENTICATED: "Your session has ended. Please sign in again.",
  FORBIDDEN: "You do not have permission to do that.",
  NOT_FOUND: "We could not find that.",
  CONFLICT: "That changed while you were working. Refresh and try again.",
  RATE_LIMITED: "Too many attempts. Wait a moment and try again.",
  QUERY_TOO_DEEP: "That request was too large to process.",
  QUERY_TOO_COSTLY: "That request was too large to process.",
};

const GENERIC = "Something went wrong.";

/** The one place API error codes become user messages. Unknown codes and the masked internal error are generic. */
export function messageFor(code: string, requestId: string | null): string {
  const known = MESSAGES[code];
  if (known !== undefined) return known;
  return requestId === null ? GENERIC : `${GENERIC} Reference: ${requestId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function issuesOf(value: unknown): FieldIssue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): FieldIssue[] =>
    isRecord(item) && typeof item.field === "string" && typeof item.message === "string"
      ? [{ field: item.field, message: item.message }]
      : [],
  );
}

/** Reads the first entry of a GraphQL `errors` array. Anything unexpected becomes the generic error. */
export function toApiError(errors: unknown, fallbackRequestId: string | null): ApiError {
  const first = Array.isArray(errors) ? errors[0] : undefined;
  const extensions = isRecord(first) && isRecord(first.extensions) ? first.extensions : {};
  const code = typeof extensions.code === "string" ? extensions.code : "INTERNAL_SERVER_ERROR";
  const requestId =
    typeof extensions.requestId === "string" ? extensions.requestId : fallbackRequestId;
  return {
    code,
    message: messageFor(code, requestId),
    requestId,
    issues: issuesOf(extensions.issues),
  };
}
