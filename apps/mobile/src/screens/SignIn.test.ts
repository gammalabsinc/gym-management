import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Auth, SignInResult } from "../auth/auth";
import { AuthProvider, useAuth } from "../auth/context";
import { SignIn } from "./SignIn";

afterEach(cleanup);

function deferred() {
  let resolve!: (value: SignInResult) => void;
  const promise = new Promise<SignInResult>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function Probe() {
  useAuth();
  return null;
}

function mount(signIn: Auth["signIn"]) {
  const auth: Auth = {
    signIn,
    signOut: vi.fn(),
    expire: vi.fn(),
    restore: vi.fn(),
  };
  return render(createElement(AuthProvider, { auth }, createElement(SignIn)));
}

describe("SignIn screen", () => {
  it("shows the welcome copy", () => {
    mount(vi.fn());
    expect(screen.getByText("Welcome to your gym.")).toBeTruthy();
    expect(screen.getByText("We only use your name and email.")).toBeTruthy();
    expect(screen.getByLabelText("Continue with Google")).toBeTruthy();
  });

  it("disables the button while signing in and ignores a second tap", async () => {
    const pending = deferred();
    const signIn = vi.fn(() => pending.promise);
    mount(signIn);
    fireEvent.click(screen.getByLabelText("Continue with Google"));
    const busy = screen.getByLabelText("Signing in") as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    expect(signIn).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ status: "signedIn" }));
  });

  it("returns to the start without a message when cancelled", async () => {
    mount(vi.fn(async () => ({ status: "cancelled" }) as const));
    await act(async () => fireEvent.click(screen.getByLabelText("Continue with Google")));
    expect(screen.getByLabelText("Continue with Google")).toBeTruthy();
    expect(screen.queryByText(/could not/i)).toBeNull();
  });

  it("shows the failure message", async () => {
    mount(vi.fn(async () => ({ status: "failed", kind: "network", message: "Offline." }) as const));
    await act(async () => fireEvent.click(screen.getByLabelText("Continue with Google")));
    expect(screen.getByText("Offline.")).toBeTruthy();
    expect(screen.getByLabelText("Continue with Google")).toBeTruthy();
  });

  it("does not update after it was unmounted", async () => {
    const pending = deferred();
    const view = mount(vi.fn(() => pending.promise));
    fireEvent.click(screen.getByLabelText("Continue with Google"));
    view.unmount();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => pending.resolve({ status: "failed", kind: "error", message: "x" }));
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("needs an AuthProvider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(createElement(Probe))).toThrow("AuthProvider");
  });
});
