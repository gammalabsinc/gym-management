import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFullBrightness } from "./brightness";
import type { CachedCard } from "./cache";
import type { CardResult } from "./card";
import { CardProvider, useCardDeps } from "./context";
import { MemberCard } from "./MemberCard";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate }) }));

afterEach(cleanup);

const cached: CachedCard = {
  updatedAt: "2026-11-25T08:30:00.000Z",
  card: {
    tenantId: "t1",
    gymName: "Iron Works",
    brandColor: "#112233",
    timezone: "UTC",
    currency: "USD",
    memberNo: "0042",
    barcode: "ABC123",
    name: "Sam Lee",
    status: "ACTIVE",
    standing: "OVERDUE",
    paidThrough: null,
    balanceDue: 7000,
  },
};

function brightness() {
  return {
    getBrightnessAsync: vi.fn(async () => 0.3),
    setBrightnessAsync: vi.fn(async () => undefined),
  };
}

function mount(load: () => Promise<CardResult>, b = brightness()) {
  const service = { load: vi.fn(load) };
  const view = render(
    createElement(CardProvider, { deps: { service, brightness: b } }, createElement(MemberCard)),
  );
  return { service, b, view };
}

describe("MemberCard", () => {
  it("shows loading, then the card", async () => {
    mount(async () => ({ status: "fresh", cached }));
    expect(screen.getByLabelText("Loading")).toBeTruthy();
    await screen.findByText("Iron Works");
    expect(screen.getByText("Sam Lee")).toBeTruthy();
    expect(screen.getByText("Member 0042")).toBeTruthy();
    expect(screen.getByText("Overdue")).toBeTruthy();
    expect(screen.getByText("Overdue. $70.00 is due.")).toBeTruthy();
    expect(screen.getByLabelText("QR code of your member barcode")).toBeTruthy();
    expect(screen.queryByText(/Offline/)).toBeNull();
  });

  it("marks an offline card with when it was updated", async () => {
    mount(async () => ({ status: "offline", cached }));
    expect(await screen.findByText(/Offline\. Last updated Nov 25, 2026/)).toBeTruthy();
  });

  it("shows a failure and retries", async () => {
    const load = vi
      .fn<() => Promise<CardResult>>()
      .mockResolvedValueOnce({ status: "failed", message: "Broken." })
      .mockResolvedValueOnce({ status: "fresh", cached });
    mount(load);
    await screen.findByText("Broken.");
    fireEvent.click(screen.getByLabelText("Try again"));
    await screen.findByText("Iron Works");
  });

  it("links to attendance and profile", async () => {
    mount(async () => ({ status: "fresh", cached }));
    fireEvent.click(await screen.findByLabelText("Attendance"));
    expect(navigate).toHaveBeenCalledWith("Visits");
    fireEvent.click(screen.getByLabelText("Profile"));
    expect(navigate).toHaveBeenCalledWith("Profile");
  });

  it("uses a member fallback when the name is missing", async () => {
    const noName = { ...cached, card: { ...cached.card, name: null } };
    mount(async () => ({ status: "fresh", cached: noName }));
    expect(await screen.findByText("Member")).toBeTruthy();
  });

  it("does not update after unmount", async () => {
    let finish!: (r: CardResult) => void;
    const { view } = mount(
      () =>
        new Promise<CardResult>((r) => {
          finish = r;
        }),
    );
    view.unmount();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => finish({ status: "failed", message: "x" }));
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("raises the brightness while open and restores it on close", async () => {
    const { b, view } = mount(async () => ({ status: "fresh", cached }));
    await screen.findByText("Iron Works");
    expect(b.setBrightnessAsync).toHaveBeenCalledWith(1);
    view.unmount();
    expect(b.setBrightnessAsync).toHaveBeenLastCalledWith(0.3);
  });

  it("needs a CardProvider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useCardDeps())).toThrow("CardProvider");
  });
});

describe("useFullBrightness", () => {
  it("leaves the level alone if the screen closes before it was read", async () => {
    let read!: (n: number) => void;
    const b = {
      getBrightnessAsync: vi.fn(
        () =>
          new Promise<number>((r) => {
            read = r;
          }),
      ),
      setBrightnessAsync: vi.fn(async () => undefined),
    };
    const { unmount } = renderHook(() => useFullBrightness(b));
    unmount();
    await act(async () => read(0.5));
    expect(b.setBrightnessAsync).not.toHaveBeenCalled();
  });

  it("ignores brightness failures", async () => {
    const b = {
      getBrightnessAsync: vi.fn(async () => {
        throw new Error("denied");
      }),
      setBrightnessAsync: vi.fn(async () => undefined),
    };
    const { unmount } = renderHook(() => useFullBrightness(b));
    await act(async () => {});
    unmount();
    expect(b.setBrightnessAsync).not.toHaveBeenCalled();
  });

  it("ignores a failing restore", async () => {
    const b = {
      getBrightnessAsync: vi.fn(async () => 0.2),
      setBrightnessAsync: vi
        .fn<(n: number) => Promise<void>>()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("x")),
    };
    const { unmount } = renderHook(() => useFullBrightness(b));
    await act(async () => {});
    unmount();
    await act(async () => {});
    expect(b.setBrightnessAsync).toHaveBeenCalledTimes(2);
  });
});
