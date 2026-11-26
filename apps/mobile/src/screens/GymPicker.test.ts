import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Auth } from "../auth/auth";
import { AuthProvider, GymsProvider, useGyms } from "../auth/context";
import type { GymList, Gyms, SelectResult } from "../gyms";
import { GymPicker } from "./GymPicker";

afterEach(cleanup);

const A = { tenantId: "a", name: "Alpha Gym", roles: ["owner"] as const };
const B = { tenantId: "b", name: "Beta Gym", roles: ["staff", "member"] as const };

function mount(list: () => Promise<GymList>, select: (id: string) => Promise<SelectResult>) {
  const gyms: Gyms = { list: vi.fn(list), select: vi.fn(select), recheck: vi.fn() };
  const auth: Auth = {
    signIn: vi.fn(),
    signOut: vi.fn(async () => ({ revoked: true, cleared: true })),
    expire: vi.fn(),
    restore: vi.fn(),
  };
  const view = render(
    createElement(
      AuthProvider,
      { auth },
      createElement(GymsProvider, { gyms }, createElement(GymPicker)),
    ),
  );
  return { gyms, auth, view };
}

const two = async (): Promise<GymList> => ({ status: "gyms", gyms: [A, B] });

function Probe() {
  useGyms();
  return null;
}

describe("GymPicker", () => {
  it("shows loading, then the gyms with their roles", async () => {
    mount(two, vi.fn());
    expect(screen.getByLabelText("Loading")).toBeTruthy();
    await screen.findByText("Alpha Gym");
    expect(screen.getByText("Owner")).toBeTruthy();
    expect(screen.getByText("Staff, Member")).toBeTruthy();
  });

  it("selects the tapped gym and ignores taps while busy", async () => {
    let finish!: (r: SelectResult) => void;
    const select = vi.fn(
      () =>
        new Promise<SelectResult>((r) => {
          finish = r;
        }),
    );
    mount(two, select);
    fireEvent.click(await screen.findByText("Beta Gym"));
    fireEvent.click(screen.getByText("Alpha Gym"));
    expect(select).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith("b");
    await act(async () => finish({ status: "entered" }));
  });

  it("goes straight in when there is one gym", async () => {
    const select = vi.fn(async () => ({ status: "entered" }) as const);
    mount(async () => ({ status: "gyms", gyms: [A] }), select);
    await waitFor(() => expect(select).toHaveBeenCalledWith("a"));
  });

  it("shows the list with a message when entering fails", async () => {
    mount(
      async () => ({ status: "gyms", gyms: [A] }),
      async () => ({ status: "failed", message: "Try later." }),
    );
    expect(await screen.findByText("Try later.")).toBeTruthy();
    expect(screen.getByText("Alpha Gym")).toBeTruthy();
  });

  it("shows the no gym screen and tries again", async () => {
    const list = vi
      .fn<() => Promise<GymList>>()
      .mockResolvedValueOnce({ status: "none" })
      .mockResolvedValueOnce({ status: "gyms", gyms: [A, B] });
    mount(list, vi.fn());
    fireEvent.click(await screen.findByLabelText("Try again"));
    await screen.findByText("Beta Gym");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("offers another account from the no gym screen and from the list", async () => {
    const none = mount(async () => ({ status: "none" }), vi.fn());
    fireEvent.click(await screen.findByLabelText("Use another account"));
    expect(none.auth.signOut).toHaveBeenCalled();
    cleanup();
    const some = mount(two, vi.fn());
    fireEvent.click(await screen.findByLabelText("Use another account"));
    expect(some.auth.signOut).toHaveBeenCalled();
  });

  it("shows a load failure with a retry", async () => {
    const list = vi
      .fn<() => Promise<GymList>>()
      .mockResolvedValueOnce({ status: "failed", message: "Offline." })
      .mockResolvedValueOnce({ status: "gyms", gyms: [A, B] });
    mount(list, vi.fn());
    await screen.findByText("Offline.");
    fireEvent.click(screen.getByLabelText("Try again"));
    await screen.findByText("Alpha Gym");
  });

  it("does not update after unmount", async () => {
    let finish!: (l: GymList) => void;
    const view = mount(
      () =>
        new Promise<GymList>((r) => {
          finish = r;
        }),
      vi.fn(),
    );
    view.view.unmount();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => finish({ status: "none" }));
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("does not update after unmount when entering fails", async () => {
    let finish!: (r: SelectResult) => void;
    const view = mount(
      async () => ({ status: "gyms", gyms: [A] }),
      () =>
        new Promise<SelectResult>((r) => {
          finish = r;
        }),
    );
    await waitFor(() => expect(finish).toBeDefined());
    view.view.unmount();
    await act(async () => finish({ status: "failed", message: "x" }));
  });

  it("needs a GymsProvider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(createElement(Probe))).toThrow("GymsProvider");
  });
});
