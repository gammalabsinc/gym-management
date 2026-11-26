import { formatDate, formatTime } from "../ui/dates";
import type { FirstCheckIn, ScanOutcome } from "./scan";

export type CardTone = "welcome" | "headsUp" | "overdue" | "neutral";
export type CardGlyph = "check" | "alert" | "dash" | "help";

/** What the full screen result card shows. Everything is decided by `describeScan` from the API result alone. */
export interface ScanCardView {
  readonly tone: CardTone;
  readonly glyph: CardGlyph;
  /** Overdue uses an octagon, every other state a circle, so shape tells them apart as well as colour. */
  readonly shape: "circle" | "octagon";
  readonly title: string;
  readonly name: string | null;
  readonly line: string | null;
  readonly note: string | null;
}

export type ShownScan = Exclude<ScanOutcome, { readonly status: "offline" }>;
type Recorded = Extract<ScanOutcome, { readonly status: "recorded" }>;

const SEND_TO_OWNER = "Let them in and send them to the owner.";

const nameOf = (outcome: Recorded): string => outcome.memberName ?? "Member";

const paidLine = (paidThrough: string | null): string =>
  paidThrough === null ? "Not paid yet" : `Paid through ${formatDate(paidThrough)}`;

function repeat(outcome: Recorded, first: FirstCheckIn | null): ScanCardView {
  return {
    tone: "neutral",
    glyph: "check",
    shape: "circle",
    title: "Already checked in",
    name: nameOf(outcome),
    line:
      first?.status === "found"
        ? `Checked in at ${formatTime(first.at, first.timezone)}`
        : "Checked in earlier",
    note: null,
  };
}

function notActive(outcome: Recorded): ScanCardView {
  const detail = {
    CANCELLED: {
      line: outcome.leftOn === null ? "Cancelled" : `Cancelled on ${formatDate(outcome.leftOn)}`,
      note: `Membership is cancelled. ${SEND_TO_OWNER}`,
    },
    PAUSED: { line: "Paused", note: `Membership is paused. ${SEND_TO_OWNER}` },
    ACTIVE: { line: "No running membership", note: `Membership is not active. ${SEND_TO_OWNER}` },
  }[outcome.membership];
  return {
    tone: "neutral",
    glyph: "dash",
    shape: "circle",
    title: "Not active",
    name: nameOf(outcome),
    ...detail,
  };
}

function standingCard(outcome: Recorded): ScanCardView {
  const base = { name: nameOf(outcome), line: paidLine(outcome.paidThrough) };
  switch (outcome.standing) {
    case "PAID":
      return {
        ...base,
        tone: "welcome",
        glyph: "check",
        shape: "circle",
        title: "Welcome",
        note: null,
      };
    case "DUE_SOON":
      return {
        ...base,
        tone: "headsUp",
        glyph: "alert",
        shape: "circle",
        title: "Heads up",
        note: "Payment due soon.",
      };
    case "OVERDUE":
      return {
        ...base,
        tone: "overdue",
        glyph: "alert",
        shape: "octagon",
        title: "Overdue",
        note:
          outcome.paidThrough === null
            ? "First payment is overdue. Let them in and remind them."
            : "Payment is overdue. Let them in and remind them.",
      };
    case "INACTIVE":
      return notActive(outcome);
  }
}

/** Picks one of the drawn states. A request error is its own card, never "not recognized". */
export function describeScan(outcome: ShownScan, first: FirstCheckIn | null): ScanCardView {
  switch (outcome.status) {
    case "notRecognized":
      return {
        tone: "neutral",
        glyph: "help",
        shape: "circle",
        title: "Barcode not recognized",
        name: null,
        line: null,
        note: "Try again, or search by name.",
      };
    case "failed":
      return {
        tone: "neutral",
        glyph: "alert",
        shape: "circle",
        title: "Could not check in",
        name: null,
        line: null,
        note: outcome.message,
      };
    case "recorded":
      if (outcome.isDuplicate) return repeat(outcome, first);
      if (outcome.membership !== "ACTIVE") return notActive(outcome);
      return standingCard(outcome);
  }
}
