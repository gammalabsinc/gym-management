export type Role = "owner" | "staff" | "member";

/** Sign in is built in a later ticket. Until then the app always starts signed out. */
export type Session =
  | { readonly status: "signedOut" }
  | { readonly status: "signedIn"; readonly role: Role };

export type Destination = "signIn" | "customer" | "admin";

export const SIGNED_OUT: Session = { status: "signedOut" };

/** The auth gate: which part of the app a session may see. */
export function destinationFor(session: Session): Destination {
  if (session.status === "signedOut") return "signIn";
  return session.role === "member" ? "customer" : "admin";
}
