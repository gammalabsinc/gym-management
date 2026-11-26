import type { MEMBER_STATUSES } from "../ui/chips";
import { formatDate } from "../ui/dates";
import { formatMoney } from "../ui/money";
import type { CardData } from "./cache";

export type CardStatus = keyof typeof MEMBER_STATUSES;

/** The chip shows what the API returned. Cancelled and paused come from the status, the rest from the standing. */
export function cardStatus(card: Pick<CardData, "status" | "standing">): CardStatus {
  if (card.status === "CANCELLED") return "cancelled";
  if (card.status === "PAUSED") return "paused";
  switch (card.standing) {
    case "PAID":
      return "paid";
    case "DUE_SOON":
      return "due_soon";
    case "OVERDUE":
      return "overdue";
    // An active member the API calls inactive has no running membership, which reads as paused.
    case "INACTIVE":
      return "paused";
  }
}

/** One line under the chip. Dates are formatted as sent, nothing is calculated from today's date. */
export function statusLine(card: CardData): string {
  const through = card.paidThrough === null ? null : formatDate(card.paidThrough);
  switch (cardStatus(card)) {
    case "paid":
      return through === null ? "Your membership is paid." : `Paid through ${through}.`;
    case "due_soon":
      return through === null
        ? "Your next payment is due soon."
        : `Paid through ${through}. Your next payment is due soon.`;
    case "overdue":
      return `Overdue. ${formatMoney(card.balanceDue, card.currency)} is due.`;
    case "paused":
      return "Your membership is paused. Ask the front desk to resume it.";
    case "cancelled":
      return "Your membership has ended.";
  }
}
