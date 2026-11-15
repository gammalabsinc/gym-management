const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A calendar date as sent by the API (`2026-12-13`) becomes "Dec 13, 2026". It has no time zone, so none is applied. */
export function formatDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const month = match === null ? undefined : MONTHS[Number(match[2]) - 1];
  if (match === null || month === undefined)
    throw new RangeError("Expected a date like 2026-12-13");
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

/** An instant becomes "Dec 13, 2026, 3:04 PM" in the gym's time zone. */
export function formatDateTime(instant: string, timeZone: string): string {
  const time = Date.parse(instant);
  if (Number.isNaN(time)) throw new RangeError("Expected an ISO date and time");
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(time));
}

/** Two letters for the avatar: first and last word of a name, or the start of the email, else "?". */
export function initials(name: string | null | undefined, email?: string): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  const last = words[words.length - 1];
  if (first !== undefined && last !== undefined) {
    return (
      words.length === 1 ? first.slice(0, 2) : (first[0] ?? "") + (last[0] ?? "")
    ).toUpperCase();
  }
  const fallback = (email ?? "").trim().slice(0, 2).toUpperCase();
  return fallback === "" ? "?" : fallback;
}
