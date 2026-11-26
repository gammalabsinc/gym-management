import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCAN_TONES } from "../ui/tokens";
import { ScanResultCard } from "./ScanResultCard";
import type { ScanCardView } from "./scan-card";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const view = (over: Partial<ScanCardView> = {}): ScanCardView => ({
  tone: "welcome",
  glyph: "check",
  shape: "circle",
  title: "Welcome",
  name: "Ayesha Khan",
  line: "Paid through Dec 13, 2026",
  note: null,
  ...over,
});

const mount = (v: ScanCardView) => {
  const onDone = vi.fn();
  render(createElement(ScanResultCard, { view: v, onDone }));
  return onDone;
};

const style = (element: HTMLElement) => JSON.parse(element.getAttribute("data-style") ?? "{}");

describe("ScanResultCard", () => {
  it("shows the title, initials, name, line and the way out", () => {
    mount(view());
    expect(screen.getByText("Welcome")).toBeTruthy();
    expect(screen.getByText("AK")).toBeTruthy();
    expect(screen.getByText("Ayesha Khan")).toBeTruthy();
    expect(screen.getByText("Paid through Dec 13, 2026")).toBeTruthy();
    expect(screen.getByText("Back to scanning in 3 seconds. Tap to skip.")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("is announced when it appears", () => {
    mount(view());
    const alert = document.querySelector('[data-role="alert"]');
    expect(alert).not.toBeNull();
    expect(screen.getByLabelText("Welcome. Tap to scan the next member.")).toBeTruthy();
  });

  it("paints each tone, and not active is grey, never green", () => {
    for (const [tone, colors] of [
      ["welcome", SCAN_TONES.welcome],
      ["headsUp", SCAN_TONES.headsUp],
      ["overdue", SCAN_TONES.overdue],
      ["neutral", SCAN_TONES.notActive],
    ] as const) {
      cleanup();
      mount(view({ tone }));
      const screenView = document.querySelector('[data-role="alert"]') as HTMLElement;
      expect(style(screenView).backgroundColor).toBe(colors.background);
    }
    expect(SCAN_TONES.notActive.background).not.toBe(SCAN_TONES.welcome.background);
  });

  it("uses a different outline for overdue and shows the note", () => {
    mount(view({ tone: "overdue", glyph: "alert", shape: "octagon", note: "Payment is overdue." }));
    expect(screen.getByText("Payment is overdue.")).toBeTruthy();
    expect(screen.getByText("!")).toBeTruthy();
  });

  it("leaves out the member block for a card without a member", () => {
    mount(view({ name: null, line: null, glyph: "help", note: "Try again." }));
    expect(screen.queryByLabelText("Member initials")).toBeNull();
    expect(screen.getByText("?")).toBeTruthy();
  });

  it("leaves out the line when there is none", () => {
    mount(view({ line: null }));
    expect(screen.getByText("Ayesha Khan")).toBeTruthy();
    expect(screen.queryByText(/Paid through/)).toBeNull();
  });

  it("counts down and calls done once after three seconds", () => {
    const onDone = mount(view());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("Back to scanning in 2 seconds. Tap to skip.")).toBeTruthy();
    expect(style(screen.getByTestId("countdown")).width).toBe("67%");
    act(() => {
      vi.advanceTimersByTime(1900);
    });
    expect(screen.getByText("Back to scanning in 1 second. Tap to skip.")).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("calls done on a tap", () => {
    const onDone = mount(view());
    fireEvent.click(screen.getByLabelText("Welcome. Tap to scan the next member."));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
