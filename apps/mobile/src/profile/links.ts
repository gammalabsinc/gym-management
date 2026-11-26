/** Keeps digits and a leading plus, so spaces and brackets in a typed number do not break the dialer. */
export function telUrl(phone: string): string {
  const plus = phone.trim().startsWith("+") ? "+" : "";
  return `tel:${plus}${phone.replace(/\D/g, "")}`;
}

export function mailUrl(email: string): string {
  return `mailto:${email}`;
}
