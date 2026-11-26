import { describe, expect, it, vi } from "vitest";
import { createSessionStore } from "./session-store";

describe("createSessionStore", () => {
  it("starts signed out without a token", () => {
    const store = createSessionStore();
    expect(store.getSession()).toEqual({ status: "signedOut" });
    expect(store.getToken()).toBeNull();
  });

  it("holds the token and role after sign in and notifies listeners", () => {
    const store = createSessionStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.signIn("tok", "staff");
    expect(store.getSession()).toEqual({ status: "signedIn", role: "staff" });
    expect(store.getToken()).toBe("tok");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("holds an identity session with the token until a gym is picked", () => {
    const store = createSessionStore();
    store.signInIdentity("tok");
    expect(store.getSession()).toEqual({ status: "identity" });
    expect(store.getToken()).toBe("tok");
    store.signIn("tok2", "member");
    expect(store.getSession()).toEqual({ status: "signedIn", role: "member" });
  });

  it("sign out clears the token and notifies once, and is a no-op when already signed out", () => {
    const store = createSessionStore();
    const listener = vi.fn();
    store.signIn("tok", "member");
    store.subscribe(listener);
    store.signOut();
    store.signOut();
    expect(store.getSession()).toEqual({ status: "signedOut" });
    expect(store.getToken()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops notifying after unsubscribe", () => {
    const store = createSessionStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.signIn("tok", "owner");
    expect(listener).not.toHaveBeenCalled();
  });
});
