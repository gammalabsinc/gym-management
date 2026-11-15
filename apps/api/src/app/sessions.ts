import { type UnauthenticatedError, unauthenticated } from "../domain/errors";
import { ok, type Result } from "../domain/result";
import { isSessionLive, MAX_TOKEN_LENGTH } from "../domain/session";
import type { Clock, IdGenerator, SessionStore, SessionTokens } from "./ports";

export interface SessionDeps {
  readonly store: SessionStore;
  readonly tokens: SessionTokens;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** When a session issued at the given time stops working. */
  readonly expiryFor: (issuedAt: Date) => Date;
}

export interface IssuedSession {
  /** Shown to the client once. Only its hash is stored. */
  readonly token: string;
  readonly expiresAt: Date;
}

export interface AuthenticatedSession {
  readonly sessionId: string;
  readonly subject: string;
}

export interface Sessions {
  issue(subject: string): Promise<IssuedSession>;
  authenticate(token: string): Promise<Result<AuthenticatedSession, UnauthenticatedError>>;
  signOut(token: string): Promise<void>;
  revokeAll(subject: string): Promise<number>;
}

function isUsableToken(token: string): boolean {
  return token !== "" && token.length <= MAX_TOKEN_LENGTH;
}

export function makeSessions(deps: SessionDeps): Sessions {
  return {
    async issue(subject) {
      if (subject.trim() === "") throw new Error("A session needs the subject of a signed in user");
      const now = deps.clock.now();
      const expiresAt = deps.expiryFor(now);
      const { token, tokenHash } = deps.tokens.generate();
      await deps.store.insert({
        id: deps.ids.next(),
        tokenHash,
        subject,
        createdAt: now,
        expiresAt,
      });
      return { token, expiresAt };
    },

    /** Every failure gives the same answer, so a caller cannot tell a revoked token from an unknown one. */
    async authenticate(token) {
      if (!isUsableToken(token)) return unauthenticated();
      const session = await deps.store.findByTokenHash(deps.tokens.hash(token));
      if (session === null || !isSessionLive(session, deps.clock.now())) return unauthenticated();
      return ok({ sessionId: session.id, subject: session.subject });
    },

    /** Signing out twice, or with a token we never issued, is not an error. */
    async signOut(token) {
      if (!isUsableToken(token)) return;
      await deps.store.revokeByTokenHash(deps.tokens.hash(token), deps.clock.now());
    },

    async revokeAll(subject) {
      return deps.store.revokeAllForSubject(subject, deps.clock.now());
    },
  };
}
