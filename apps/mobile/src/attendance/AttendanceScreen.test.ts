import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Attendance } from "./Attendance";
import type { AttendanceService, FirstAttendance, MoreAttendance, VisitRow } from "./attendance";
import { AttendanceProvider, useAttendanceService } from "./context";
import { useAttendance } from "./useAttendance";

afterEach(cleanup);

const visit = (id: string, localDate: string, scannedAt: string): VisitRow => ({
  id,
  localDate,
  scannedAt,
});

const ready = (
  over: Partial<Extract<FirstAttendance, { status: "ready" }>> = {},
): FirstAttendance => ({
  status: "ready",
  memberId: "m1",
  timezone: "America/Toronto",
  visitsThisMonth: 4,
  visitsLastMonth: 9,
  items: [
    visit("v2", "2026-11-21", "2026-11-21T22:15:00Z"),
    visit("v1", "2026-10-30", "2026-10-30T13:05:00Z"),
  ],
  nextCursor: null,
  ...over,
});

function mount(first: AttendanceService["first"], more?: AttendanceService["more"]) {
  const service = {
    first: vi.fn(first),
    more: vi.fn(
      more ??
        (async (): Promise<MoreAttendance> => ({ status: "page", items: [], nextCursor: null })),
    ),
  };
  render(createElement(AttendanceProvider, { service }, createElement(Attendance)));
  return service;
}

const settle = () => act(async () => {});

describe("Attendance", () => {
  it("shows loading, then both counts and the visits grouped by month in the gym's time zone", async () => {
    mount(async () => ready());
    expect(screen.getByLabelText("Loading")).toBeTruthy();
    await settle();
    expect(screen.getByLabelText("4 visits this month")).toBeTruthy();
    expect(screen.getByLabelText("9 visits last month")).toBeTruthy();
    expect(screen.getByText("November 2026")).toBeTruthy();
    expect(screen.getByText("October 2026")).toBeTruthy();
    expect(screen.getByText("Sat Nov 21")).toBeTruthy();
    // 22:15 UTC is 5:15 PM in Toronto, and 13:05 UTC is 9:05 AM.
    expect(screen.getByText("5:15 PM")).toBeTruthy();
    expect(screen.getByText("9:05 AM")).toBeTruthy();
    expect(screen.queryByText("No visits yet")).toBeNull();
  });

  it("shows the empty state and keeps the counts", async () => {
    mount(async () => ready({ items: [], visitsThisMonth: 0, visitsLastMonth: 0 }));
    await settle();
    expect(screen.getByText("No visits yet")).toBeTruthy();
    expect(screen.getByLabelText("0 visits this month")).toBeTruthy();
  });

  it("shows the error state and retries", async () => {
    const first = vi
      .fn<AttendanceService["first"]>()
      .mockResolvedValueOnce({ status: "failed", message: "x" })
      .mockResolvedValueOnce(ready());
    mount(first);
    await settle();
    expect(screen.getByText("Could not load your visits")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Try again"));
    await settle();
    expect(screen.getByText("November 2026")).toBeTruthy();
    expect(first).toHaveBeenCalledTimes(2);
  });

  it("loads older months on scroll and joins a month that continues", async () => {
    const service = mount(
      async () => ready({ nextCursor: "c1" }),
      async () => ({
        status: "page",
        items: [
          visit("v0", "2026-10-02", "2026-10-02T13:00:00Z"),
          visit("v-9", "2026-09-28", "2026-09-28T13:00:00Z"),
        ],
        nextCursor: null,
      }),
    );
    await settle();
    fireEvent.click(screen.getByLabelText("Reach the end"));
    await settle();
    expect(service.more).toHaveBeenCalledWith("m1", "c1");
    expect(screen.getAllByText("October 2026").length).toBe(1);
    expect(screen.getByText("September 2026")).toBeTruthy();
    // The cursor is spent, so reaching the end again asks for nothing more.
    fireEvent.click(screen.getByLabelText("Reach the end"));
    await settle();
    expect(service.more).toHaveBeenCalledTimes(1);
  });

  it("does not ask twice while older visits are loading", async () => {
    let release: (page: MoreAttendance) => void = () => {};
    const service = mount(
      async () => ready({ nextCursor: "c1" }),
      () => new Promise<MoreAttendance>((resolve) => (release = resolve)),
    );
    await settle();
    fireEvent.click(screen.getByLabelText("Reach the end"));
    await settle();
    expect(screen.getAllByLabelText("Loading").length).toBe(1);
    fireEvent.click(screen.getByLabelText("Reach the end"));
    await settle();
    expect(service.more).toHaveBeenCalledTimes(1);
    await act(async () => release({ status: "page", items: [], nextCursor: null }));
    expect(screen.queryByLabelText("Loading")).toBeNull();
  });

  it("keeps the visits shown when older ones fail, and tries again", async () => {
    const more = vi
      .fn<AttendanceService["more"]>()
      .mockResolvedValueOnce({ status: "failed", message: "x" })
      .mockResolvedValueOnce({
        status: "page",
        items: [visit("v0", "2026-09-28", "2026-09-28T13:00:00Z")],
        nextCursor: null,
      });
    mount(async () => ready({ nextCursor: "c1" }), more);
    await settle();
    fireEvent.click(screen.getByLabelText("Reach the end"));
    await settle();
    expect(screen.getByText("Could not load older visits")).toBeTruthy();
    expect(screen.getByText("November 2026")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Try again"));
    await settle();
    expect(screen.queryByText("Could not load older visits")).toBeNull();
    expect(screen.getByText("September 2026")).toBeTruthy();
  });

  it("drops an answer that arrives after leaving the screen", async () => {
    let release: (page: MoreAttendance) => void = () => {};
    const service = mount(
      async () => ready({ nextCursor: "c1" }),
      () => new Promise<MoreAttendance>((resolve) => (release = resolve)),
    );
    await settle();
    fireEvent.click(screen.getByLabelText("Reach the end"));
    await settle();
    cleanup();
    await act(async () =>
      release({
        status: "page",
        items: [visit("x", "2026-08-01", "2026-08-01T10:00:00Z")],
        nextCursor: null,
      }),
    );
    expect(service.more).toHaveBeenCalledTimes(1);
  });
});

describe("useAttendanceService", () => {
  it("fails loudly without a provider", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useAttendanceService())).toThrow("AttendanceProvider");
    quiet.mockRestore();
  });
});

describe("useAttendance", () => {
  it("keeps the newest load when an older one answers last", async () => {
    const resolvers: Array<(result: FirstAttendance) => void> = [];
    const service: AttendanceService = {
      first: () => new Promise<FirstAttendance>((resolve) => resolvers.push(resolve)),
      more: async () => ({ status: "page", items: [], nextCursor: null }),
    };
    const { result } = renderHook(() => useAttendance(service));
    act(() => result.current.retry());
    await act(async () => resolvers[1]?.(ready({ visitsThisMonth: 7 })));
    await act(async () => resolvers[0]?.(ready({ visitsThisMonth: 1 })));
    expect(result.current.state).toMatchObject({ status: "ready", visitsThisMonth: 7 });
  });

  it("does nothing when older visits are asked for before the first load", () => {
    const service: AttendanceService = {
      first: () => new Promise<FirstAttendance>(() => {}),
      more: vi.fn(),
    };
    const { result } = renderHook(() => useAttendance(service));
    act(() => result.current.loadMore());
    expect(service.more).not.toHaveBeenCalled();
  });
});
