/** Builds the expiry rule for new sessions. Refuses a lifetime that is not a positive whole number. */
export function expiresAfter(lifetimeMs: number): (issuedAt: Date) => Date {
  if (!Number.isInteger(lifetimeMs) || lifetimeMs <= 0) {
    throw new Error("Session lifetime must be a positive whole number of milliseconds");
  }
  return (issuedAt) => new Date(issuedAt.getTime() + lifetimeMs);
}
