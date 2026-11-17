export const MAX_EMAIL_LENGTH = 254;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The form an email is stored in: trimmed and lower case. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** True for a normalized email that is short enough and has the shape name@host.tld. */
export function isEmailAddress(email: string): boolean {
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email);
}
