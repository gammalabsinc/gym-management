import { type Role, type Session, SIGNED_OUT } from "./session";

export interface SessionStore {
  getSession(): Session;
  getToken(): string | null;
  signIn(token: string, role: Role): void;
  /** Used when the API reports an expired or revoked session, from any screen. */
  signOut(): void;
  subscribe(listener: () => void): () => void;
}

/** Holds the session and its bearer token in memory. Persistence is added with sign in. */
export function createSessionStore(): SessionStore {
  let session: Session = SIGNED_OUT;
  let token: string | null = null;
  const listeners = new Set<() => void>();

  function set(next: Session, nextToken: string | null): void {
    session = next;
    token = nextToken;
    for (const listener of [...listeners]) listener();
  }

  return {
    getSession: () => session,
    getToken: () => token,
    signIn: (nextToken, role) => set({ status: "signedIn", role }, nextToken),
    signOut: () => {
      if (session.status === "signedOut") return;
      set(SIGNED_OUT, null);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
