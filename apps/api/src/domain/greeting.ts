export type DayPart = "morning" | "afternoon" | "evening";

/** Total function: every hour of the day maps to exactly one part. */
export function dayPartOfHour(hourUtc: number): DayPart {
  if (hourUtc < 12) return "morning";
  if (hourUtc < 18) return "afternoon";
  return "evening";
}

export function buildGreeting(name: string, hourUtc: number): string {
  return `Good ${dayPartOfHour(hourUtc)}, ${name}`;
}
