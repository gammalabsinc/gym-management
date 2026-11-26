import { type Role, type Session, SIGNED_OUT } from "./session";

export interface SessionStore {
  getSession(): Session;
  getToken(): string | null;
  /** Signed in with Google, no gym picked yet. */
  signInIdentity(token: string): void;
  signIn(token: string, role: Role): void;
  /** The server confirmed the gym and the role. The token stays, the session is now bound to that gym. */
  enterGym(role: Role, tenantId: string): void;
  /** Back to the gym picker, for example after losing access to the gym. */
  leaveGym(): void;
  /** The gym the server bound this session to, or null before one is picked. */
  getTenantId(): string | null;
  /** Used when the API reports an expired or revoked session, from any screen. */
  signOut(): void;
  subscribe(listener: () => void): () => void;
}

/** Holds the session and its bearer token in memory. The device copy lives in token storage. */
export function createSessionStore(): SessionStore {
  let session: Session = SIGNED_OUT;
  let token: string | null = null;
  let tenantId: string | null = null;
  const listeners = new Set<() => void>();

  function set(next: Session, nextToken: string | null, nextTenantId: string | null = null): void {
    session = next;
    token = nextToken;
    tenantId = nextTenantId;
    for (const listener of [...listeners]) listener();
  }

  return {
    getSession: () => session,
    getToken: () => token,
    signInIdentity: (nextToken) => set({ status: "identity" }, nextToken),
    signIn: (nextToken, role) => set({ status: "signedIn", role }, nextToken),
    enterGym(role, nextTenantId) {
      if (session.status === "signedOut") return;
      set({ status: "signedIn", role }, token, nextTenantId);
    },
    leaveGym() {
      if (session.status !== "signedIn") return;
      set({ status: "identity" }, token);
    },
    getTenantId: () => tenantId,
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
