import { type ConflictError, conflict, type ValidationError, validationError } from "./errors";
import { ok, type Result } from "./result";
import type { MembershipStatus } from "./standing";

export const MAX_REASON_LENGTH = 200;

export const MEMBERSHIP_ACTIONS = ["pause", "resume", "cancel"] as const;
export type MembershipAction = (typeof MEMBERSHIP_ACTIONS)[number];

/** The status a member ends up in after each action. */
const RESULTING_STATUS: Readonly<Record<MembershipAction, MembershipStatus>> = {
  pause: "paused",
  resume: "active",
  cancel: "cancelled",
};

/** The statuses each action may start from. A cancelled membership never changes again here. */
const ALLOWED_FROM: Readonly<Record<MembershipAction, readonly MembershipStatus[]>> = {
  pause: ["active"],
  resume: ["paused"],
  cancel: ["active", "paused"],
};

/** What staff type on the pause, resume or cancel sheet. */
export interface MembershipChangeInput {
  readonly memberId: string;
  readonly reason: string;
}

/** Trims the reason and requires it, with a length cap. */
export function parseReason(reason: string): Result<string, ValidationError> {
  const trimmed = reason.trim();
  if (trimmed === "") {
    return validationError("Invalid membership change", [
      { path: ["reason"], message: "A reason is required" },
    ]);
  }
  if (trimmed.length > MAX_REASON_LENGTH) {
    return validationError("Invalid membership change", [
      { path: ["reason"], message: `At most ${MAX_REASON_LENGTH} characters` },
    ]);
  }
  return ok(trimmed);
}

/** The status the member moves to, or a conflict when the action does not fit the current status. */
export function nextStatus(
  action: MembershipAction,
  current: MembershipStatus,
): Result<MembershipStatus, ConflictError> {
  if (ALLOWED_FROM[action].includes(current)) return ok(RESULTING_STATUS[action]);
  return conflict(`A ${current} membership cannot be ${PAST_TENSE[action]}`);
}

const PAST_TENSE: Readonly<Record<MembershipAction, string>> = {
  pause: "paused",
  resume: "resumed",
  cancel: "cancelled",
};

/**
 * The day the change takes effect: the gym's today, but never before the current period began, so
 * the closed period always satisfies valid_to >= valid_from.
 */
export function effectiveDate(today: string, currentValidFrom: string): string {
  return today < currentValidFrom ? currentValidFrom : today;
}
