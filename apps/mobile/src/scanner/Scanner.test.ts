import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CameraPermission, CameraPort } from "./camera";
import { ScannerProvider, useScannerDeps } from "./context";
import { Scanner } from "./Scanner";
import type { FirstCheckIn, ScanOutcome, SearchResult } from "./scan";

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

function setup(
  status: CameraPermission,
  record: (code: string) => Promise<ScanOutcome>,
  firstCheckIn: (memberId: string) => Promise<FirstCheckIn> = async () => ({ status: "unknown" }),
) {
  const request = vi.fn();
  const openSettings = vi.fn(async () => undefined);
  const camera: CameraPort = {
    usePermission: () => ({ status, request }),
    Scanner: FakeScanner,
    openSettings,
  };
  const service = {
    record: vi.fn(record),
    firstCheckIn: vi.fn(firstCheckIn),
    search: vi.fn(async (): Promise<SearchResult> => ({ status: "results", rows: [] })),
  };
  const view = render(
    createElement(ScannerProvider, { deps: { service, camera } }, createElement(Scanner)),
  );
  return { request, openSettings, service, view };
}

const recorded: ScanOutcome = {
  status: "recorded",
  memberId: "m1",
  memberName: "Sam Lee",
  standing: "PAID",
  paidThrough: "2026-12-13",
  membership: "ACTIVE",
  leftOn: null,
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
    const service = { record: vi.fn(), firstCheckIn: vi.fn(), search: vi.fn() };
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
    expect(screen.getByText("Welcome")).toBeTruthy();
    expect(screen.getByText("Paid through Dec 13, 2026")).toBeTruthy();
    act(() => emit("ABC123"));
    expect(s.service.record).toHaveBeenCalledTimes(1);
  });

  it("scans again when the result is tapped away", async () => {
    const s = setup("granted", async () => recorded);
    await act(async () => emit("A"));
    fireEvent.click(screen.getByLabelText("Welcome. Tap to scan the next member."));
    expect(pausedNow).toBe(false);
    await act(async () => emit("B"));
    expect(s.service.record).toHaveBeenCalledTimes(2);
  });

  it("goes back to scanning by itself after three seconds", async () => {
    vi.useFakeTimers();
    try {
      const s = setup("granted", async () => recorded);
      await act(async () => emit("A"));
      expect(screen.getByText("Welcome")).toBeTruthy();
      await act(async () => {
        vi.advanceTimersByTime(2900);
      });
      expect(screen.getByText("Welcome")).toBeTruthy();
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByText("Welcome")).toBeNull();
      expect(screen.getByTestId("camera")).toBeTruthy();
      await act(async () => emit("B"));
      expect(s.service.record).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a repeat scan with the time of the first check in, and does not look it up otherwise", async () => {
    const lookup = vi.fn(
      async (): Promise<FirstCheckIn> => ({
        status: "found",
        at: "2026-11-26T12:12:00Z",
        timezone: "America/Toronto",
      }),
    );
    const s = setup("granted", async () => ({ ...recorded, isDuplicate: true }), lookup);
    await act(async () => emit("A"));
    expect(lookup).toHaveBeenCalledWith("m1");
    expect(screen.getByText("Already checked in")).toBeTruthy();
    expect(screen.getByText("Checked in at 7:12 AM")).toBeTruthy();
    cleanup();
    const plain = setup("granted", async () => recorded);
    await act(async () => emit("A"));
    expect(plain.service.firstCheckIn).not.toHaveBeenCalled();
    expect(s.service.firstCheckIn).toHaveBeenCalledTimes(1);
  });

  it("still shows a repeat scan when the first check in cannot be read", async () => {
    setup("granted", async () => ({ ...recorded, isDuplicate: true }));
    await act(async () => emit("A"));
    expect(screen.getByText("Already checked in")).toBeTruthy();
    expect(screen.getByText("Checked in earlier")).toBeTruthy();
  });

  it("shows an unknown barcode and a request error as different cards", async () => {
    setup("granted", async () => ({ status: "notRecognized" }));
    await act(async () => emit("X"));
    expect(screen.getByText("Barcode not recognized")).toBeTruthy();
    expect(screen.getByText("Try again, or search by name.")).toBeTruthy();
    cleanup();
    setup("granted", async () => ({ status: "failed", message: "Nope." }));
    await act(async () => emit("X"));
    expect(screen.getByText("Could not check in")).toBeTruthy();
    expect(screen.getByText("Nope.")).toBeTruthy();
    expect(screen.queryByText("Barcode not recognized")).toBeNull();
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

  it("checks a member in from the search and shows the same result card as a scan", async () => {
    const s = setup("granted", async () => recorded);
    s.service.search.mockResolvedValue({
      status: "results",
      rows: [
        {
          memberId: "m1",
          barcode: "ABC123",
          name: "Sam Lee",
          memberNo: "0042",
          status: "ACTIVE",
          standing: "PAID",
        },
      ],
    });
    fireEvent.click(screen.getByLabelText("Search"));
    fireEvent.change(screen.getByLabelText("Search members"), { target: { value: "sam" } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    fireEvent.click(await screen.findByText("Check in Sam Lee"));
    await act(async () => undefined);
    expect(s.service.record).toHaveBeenCalledWith("ABC123", "MANUAL");
    expect(screen.getByText("Welcome")).toBeTruthy();
  });

  it("says so when there is no connection during a check in from the search", async () => {
    const s = setup("granted", async () => ({ status: "offline" }));
    s.service.search.mockResolvedValue({
      status: "results",
      rows: [
        {
          memberId: "m1",
          barcode: "ABC123",
          name: "Sam Lee",
          memberNo: "0042",
          status: "ACTIVE",
          standing: "PAID",
        },
      ],
    });
    fireEvent.click(screen.getByLabelText("Search"));
    fireEvent.change(screen.getByLabelText("Search members"), { target: { value: "sam" } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    fireEvent.click(await screen.findByText("Check in Sam Lee"));
    await act(async () => undefined);
    expect(screen.getByText("No connection")).toBeTruthy();
  });

  it("ignores a check in from the search that finishes after unmount", async () => {
    let finish!: (o: ScanOutcome) => void;
    const s = setup(
      "granted",
      () =>
        new Promise<ScanOutcome>((r) => {
          finish = r;
        }),
    );
    s.service.search.mockResolvedValue({
      status: "results",
      rows: [
        {
          memberId: "m1",
          barcode: "ABC123",
          name: "Sam Lee",
          memberNo: "0042",
          status: "ACTIVE",
          standing: "PAID",
        },
      ],
    });
    fireEvent.click(screen.getByLabelText("Search"));
    fireEvent.change(screen.getByLabelText("Search members"), { target: { value: "sam" } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    fireEvent.click(await screen.findByText("Check in Sam Lee"));
    s.view.unmount();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => finish(recorded));
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
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

  it("ignores a first check in that arrives after unmount", async () => {
    let finish!: (first: FirstCheckIn) => void;
    const s = setup(
      "granted",
      async () => ({ ...recorded, isDuplicate: true }),
      () =>
        new Promise<FirstCheckIn>((r) => {
          finish = r;
        }),
    );
    await act(async () => emit("X"));
    s.view.unmount();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => finish({ status: "unknown" }));
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("needs a ScannerProvider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(createElement(Probe))).toThrow("ScannerProvider");
  });
});
