import { describe, expect, it, vi } from "vitest";
import {
  createAuth,
  GOOGLE_FAILED_MESSAGE,
  REJECTED_MESSAGE,
  STORAGE_FAILED_MESSAGE,
} from "./auth";
import type { GoogleResult } from "./google";
import { createSessionStore } from "./session-store";
import type { TokenStorage } from "./token-storage";

function setup(options: {
  google?: GoogleResult;
  outcome?: unknown;
  stored?: string | null;
  writeFails?: boolean;
  clearFails?: boolean;
  readFails?: boolean;
}) {
  const store = createSessionStore();
  let kept: string | null = options.stored ?? null;
  const storage: TokenStorage = {
    read: async () => {
      if (options.readFails) throw new Error("keystore");
      return kept;
    },
    write: async (token) => {
      if (options.writeFails) throw new Error("full");
      kept = token;
    },
    clear: async () => {
      if (options.clearFails) throw new Error("locked");
      kept = null;
    },
  };
  const google = {
    signIn: vi.fn(async () => options.google ?? { status: "success" as const, idToken: "g" }),
    signOut: vi.fn(async () => undefined),
  };
  const client = {
    execute: vi.fn(async () => options.outcome ?? { status: "empty" }),
  };
  // biome-ignore lint/suspicious/noExplicitAny: the fake client answers every operation with one outcome
  const auth = createAuth({ google, client: client as any, storage, store });
  return { auth, store, google, client, kept: () => kept };
}

const signedIn = (token: string | null, errors: unknown[] = []) => ({
  status: "data",
  data: { signIn: { token, expiresAt: null, errors } },
});

describe("sign in", () => {
  it("exchanges the google token, keeps the session token and enters the identity state", async () => {
    const s = setup({ outcome: signedIn("session") });
    expect(await s.auth.signIn()).toEqual({ status: "signedIn" });
    expect(s.kept()).toBe("session");
    expect(s.store.getSession()).toEqual({ status: "identity" });
    expect(s.store.getToken()).toBe("session");
    const sent = JSON.stringify(s.client.execute.mock.calls[0]);
    expect(sent).toContain('"signIn_idToken":"g"');
  });

  it("does nothing when the person cancels", async () => {
    const s = setup({ google: { status: "cancelled" } });
    expect(await s.auth.signIn()).toEqual({ status: "cancelled" });
    expect(s.client.execute).not.toHaveBeenCalled();
  });

  it("reports a google failure with a fixed message", async () => {
    const s = setup({ google: { status: "failed" } });
    expect(await s.auth.signIn()).toEqual({
      status: "failed",
      kind: "error",
      message: GOOGLE_FAILED_MESSAGE,
    });
  });

  it("reports a network failure", async () => {
    const s = setup({ outcome: { status: "network", message: "offline" } });
    expect(await s.auth.signIn()).toEqual({
      status: "failed",
      kind: "network",
      message: "offline",
    });
  });

  it("reports an api error", async () => {
    const s = setup({ outcome: { status: "error", error: { message: "nope" } } });
    expect(await s.auth.signIn()).toEqual({ status: "failed", kind: "error", message: "nope" });
  });

  it("rejects an empty answer, an error list and a missing token", async () => {
    for (const outcome of [{ status: "empty" }, signedIn("t", [{ code: "X" }]), signedIn(null)]) {
      const s = setup({ outcome });
      expect(await s.auth.signIn()).toEqual({
        status: "failed",
        kind: "error",
        message: REJECTED_MESSAGE,
      });
      expect(s.store.getSession().status).toBe("signedOut");
    }
  });

  it("does not sign in when the token cannot be stored", async () => {
    const s = setup({ outcome: signedIn("t"), writeFails: true });
    expect(await s.auth.signIn()).toEqual({
      status: "failed",
      kind: "error",
      message: STORAGE_FAILED_MESSAGE,
    });
    expect(s.store.getSession().status).toBe("signedOut");
  });

  it("shares one attempt between two taps, then allows another", async () => {
    const s = setup({ outcome: signedIn("t") });
    const [a, b] = [s.auth.signIn(), s.auth.signIn()];
    expect(a).toBe(b);
    await a;
    expect(s.google.signIn).toHaveBeenCalledTimes(1);
    await s.auth.signIn();
    expect(s.google.signIn).toHaveBeenCalledTimes(2);
  });
});

describe("sign out and expiry", () => {
  it("revokes on the server, then clears the device", async () => {
    const s = setup({ outcome: { status: "data", data: { signOut: true } }, stored: "t" });
    s.store.signInIdentity("t");
    expect(await s.auth.signOut()).toEqual({ revoked: true, cleared: true });
    expect(s.store.getSession().status).toBe("signedOut");
    expect(s.google.signOut).toHaveBeenCalled();
    expect(s.kept()).toBeNull();
  });

  it("clears the device even when the server cannot be reached", async () => {
    const s = setup({ outcome: { status: "network", message: "offline" }, stored: "t" });
    s.store.signInIdentity("t");
    expect(await s.auth.signOut()).toEqual({ revoked: false, cleared: true });
    expect(s.kept()).toBeNull();
  });

  it("reports when the device could not be cleared", async () => {
    const s = setup({ outcome: { status: "data", data: { signOut: true } }, clearFails: true });
    expect(await s.auth.signOut()).toEqual({ revoked: true, cleared: false });
  });

  it("expires without calling the server", async () => {
    const s = setup({ stored: "t" });
    s.store.signInIdentity("t");
    expect(await s.auth.expire()).toEqual({ revoked: false, cleared: true });
    expect(s.client.execute).not.toHaveBeenCalled();
    expect(s.store.getSession().status).toBe("signedOut");
  });
});

describe("restore", () => {
  it("signs in again from a kept token", async () => {
    const s = setup({ stored: "kept" });
    await s.auth.restore();
    expect(s.store.getSession()).toEqual({ status: "identity" });
    expect(s.store.getToken()).toBe("kept");
  });

  it("stays signed out with no token or an unreadable store", async () => {
    for (const options of [{}, { readFails: true, stored: "x" }]) {
      const s = setup(options);
      await s.auth.restore();
      expect(s.store.getSession().status).toBe("signedOut");
    }
  });

  it("does not override a session that already exists", async () => {
    const s = setup({ stored: "old" });
    s.store.signIn("new", "member");
    await s.auth.restore();
    expect(s.store.getToken()).toBe("new");
  });
});
