export type Role = "owner" | "staff" | "member";

/**
 * `identity` is signed in with Google but no gym picked yet. The gym picker turns it into
 * `signedIn`, with the role the person holds in that gym.
 */
export type Session =
  | { readonly status: "signedOut" }
  | { readonly status: "identity" }
  | { readonly status: "signedIn"; readonly role: Role };

export type Destination = "signIn" | "picker" | "customer" | "admin";

export const SIGNED_OUT: Session = { status: "signedOut" };

/** The auth gate: which part of the app a session may see. */
export function destinationFor(session: Session): Destination {
  if (session.status === "signedOut") return "signIn";
  if (session.status === "identity") return "picker";
  return session.role === "member" ? "customer" : "admin";
}
