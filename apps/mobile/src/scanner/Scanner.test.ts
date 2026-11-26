import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CameraPermission, CameraPort } from "./camera";
import { ScannerProvider, useScannerDeps } from "./context";
import { Scanner } from "./Scanner";
import type { ScanOutcome } from "./scan";

const focus = vi.hoisted(() => ({ focused: true }));
vi.mock("@react-navigation/native", () => ({ useIsFocused: () => focus.focused }));

beforeEach(() => {
  focus.focused = true;
});
afterEach(cleanup);

function Probe() {
  useScannerDeps();
  return null;
}

let emit: (value: string) => void = () => {};
let pausedNow = false;

function FakeScanner(props: { paused: boolean; onScan: (value: string) => void }) {
  emit = props.onScan;
  pausedNow = props.paused;
  return createElement("div", { "data-testid": "camera" });
}

function NullScanner() {
  return null;
}

function setup(status: CameraPermission, record: (code: string) => Promise<ScanOutcome>) {
  const request = vi.fn();
  const openSettings = vi.fn(async () => undefined);
  const camera: CameraPort = {
    usePermission: () => ({ status, request }),
    Scanner: FakeScanner,
    openSettings,
  };
  const service = { record: vi.fn(record) };
  const view = render(
    createElement(ScannerProvider, { deps: { service, camera } }, createElement(Scanner)),
  );
  return { request, openSettings, service, view };
}

const recorded: ScanOutcome = {
  status: "recorded",
  memberName: "Sam Lee",
  standing: "PAID",
  paidThrough: "2026-12-13",
  isDuplicate: false,
};

describe("Scanner", () => {
  it("shows the camera when allowed", () => {
    setup("granted", async () => recorded);
    expect(screen.getByTestId("camera")).toBeTruthy();
    expect(screen.getByText("Hold the code inside the frame")).toBeTruthy();
  });

  it("asks for permission once, even when the request function changes on every render", () => {
    const request = vi.fn();
    const camera: CameraPort = {
      usePermission: () => ({ status: "undetermined", request: () => request() }),
      Scanner: NullScanner,
      openSettings: async () => undefined,
    };
    const service = { record: vi.fn() };
    const tree = () =>
      createElement(ScannerProvider, { deps: { service, camera } }, createElement(Scanner));
    const view = render(tree());
    view.rerender(tree());
    view.rerender(tree());
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("camera")).toBeNull();
  });

  it("waits quietly while the permission loads", () => {
    const s = setup("loading", async () => recorded);
    expect(s.request).not.toHaveBeenCalled();
    expect(screen.queryByTestId("camera")).toBeNull();
    expect(screen.getByText("Check in")).toBeTruthy();
  });

  it("shows the camera off state with settings and search", () => {
    const s = setup("denied", async () => recorded);
    expect(screen.getByText("Camera is off")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Open settings"));
    expect(s.openSettings).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Search by name"));
    expect(screen.getByText("Check in by search")).toBeTruthy();
  });

  it("releases the camera when the screen loses focus", () => {
    focus.focused = false;
    setup("granted", async () => recorded);
    expect(screen.queryByTestId("camera")).toBeNull();
  });

  it("sends one request for repeated reads and pauses while it is in flight", async () => {
    let finish!: (o: ScanOutcome) => void;
    const s = setup(
      "granted",
      () =>
        new Promise<ScanOutcome>((r) => {
          finish = r;
        }),
    );
    act(() => emit("ABC123"));
    act(() => emit("ABC123"));
    expect(s.service.record).toHaveBeenCalledTimes(1);
    expect(s.service.record).toHaveBeenCalledWith("ABC123");
    expect(pausedNow).toBe(true);
    await act(async () => finish(recorded));
    expect(screen.getByText("Checked in")).toBeTruthy();
    expect(screen.getByText("Sam Lee. Paid through Dec 13, 2026.")).toBeTruthy();
    act(() => emit("ABC123"));
    expect(s.service.record).toHaveBeenCalledTimes(1);
  });

  it("scans again after the result is dismissed", async () => {
    const s = setup("granted", async () => recorded);
    await act(async () => emit("A"));
    fireEvent.click(screen.getByLabelText("Scan next"));
    expect(pausedNow).toBe(false);
    await act(async () => emit("B"));
    expect(s.service.record).toHaveBeenCalledTimes(2);
  });

  it("words each result", async () => {
    const cases: [ScanOutcome, string, string | null][] = [
      [{ ...recorded, isDuplicate: true }, "Already checked in", "Sam Lee"],
      [{ ...recorded, memberName: null, paidThrough: null }, "Checked in", "Member"],
      [{ status: "notRecognized" }, "Barcode not recognized", "Try again, or search by name."],
      [{ status: "failed", message: "Nope." }, "Could not check in", "Nope."],
    ];
    for (const [outcome, title, detail] of cases) {
      cleanup();
      setup("granted", async () => outcome);
      await act(async () => emit("X"));
      expect(screen.getByText(title)).toBeTruthy();
      if (detail !== null) expect(screen.getByText(detail)).toBeTruthy();
    }
  });

  it("says scans cannot be saved when offline, queues nothing and retries on request", async () => {
    const s = setup("granted", async () => ({ status: "offline" }));
    await act(async () => emit("X"));
    expect(screen.getByText("No connection")).toBeTruthy();
    expect(screen.getByText(/Scans cannot be saved/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Try again"));
    expect(screen.getByTestId("camera")).toBeTruthy();
    expect(s.service.record).toHaveBeenCalledTimes(1);
  });

  it("goes to search from the scanner and back", () => {
    setup("granted", async () => recorded);
    fireEvent.click(screen.getByLabelText("Search"));
    expect(screen.getByText("Check in by search")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Back to scanner"));
    expect(screen.getByTestId("camera")).toBeTruthy();
  });

  it("ignores an answer that arrives after unmount", async () => {
    let finish!: (o: ScanOutcome) => void;
    const s = setup(
      "granted",
      () =>
        new Promise<ScanOutcome>((r) => {
          finish = r;
        }),
    );
    act(() => emit("X"));
    s.view.unmount();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => finish(recorded));
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("needs a ScannerProvider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(createElement(Probe))).toThrow("ScannerProvider");
  });
});
