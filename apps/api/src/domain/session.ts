/** A stored session, as the domain sees it. The token itself is never part of it. */
export interface Session {
  readonly id: string;
  /** The Google subject id, the one identity that spans every gym the person belongs to. */
  readonly subject: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

/** The longest token the service looks at. Real tokens are far shorter, so this only stops abuse. */
export const MAX_TOKEN_LENGTH = 512;

/** A session is usable until it is revoked or reaches its expiry. */
export function isSessionLive(session: Session, now: Date): boolean {
  return session.revokedAt === null && now.getTime() < session.expiresAt.getTime();
}

const BEARER = /^Bearer ([^\s]+)$/i;

/**
 * Reads the token out of an Authorization header. Returns null when the header is missing,
 * is not a bearer header, or carries a token that is too long to be ours.
 */
export function parseBearerToken(header: string | null | undefined): string | null {
  if (header === null || header === undefined) return null;
  const match = BEARER.exec(header.trim());
  const token = match?.[1];
  if (token === undefined || token.length > MAX_TOKEN_LENGTH) return null;
  return token;
}
