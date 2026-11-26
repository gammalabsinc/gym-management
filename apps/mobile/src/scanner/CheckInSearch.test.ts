import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckInSearch, SEARCH_DEBOUNCE_MS } from "./CheckInSearch";
import type { SearchResult, SearchRow } from "./scan";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const sam: SearchRow = {
  memberId: "m1",
  barcode: "ABC123",
  name: "Sam Lee",
  memberNo: "0042",
  status: "ACTIVE",
  standing: "PAID",
};
const unnamed: SearchRow = { ...sam, memberId: "m2", name: null, memberNo: "0043" };

const found = (...rows: SearchRow[]): SearchResult => ({ status: "results", rows });

function mount(
  search: (text: string) => Promise<SearchResult>,
  onCheckIn: (row: SearchRow) => Promise<void> = async () => undefined,
) {
  const service = { search: vi.fn(search) };
  const onBack = vi.fn();
  const check = vi.fn(onCheckIn);
  const view = render(createElement(CheckInSearch, { service, onCheckIn: check, onBack }));
  return { service, onBack, check, view };
}

async function type(text: string) {
  fireEvent.change(screen.getByLabelText("Search members"), { target: { value: text } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
  });
}

describe("CheckInSearch", () => {
  it("asks nothing until something is typed", () => {
    const s = mount(async () => found());
    expect(screen.getByText("Search for a member")).toBeTruthy();
    expect(s.service.search).not.toHaveBeenCalled();
  });

  it("waits for a pause in typing, then shows rows with a status chip and member number", async () => {
    const s = mount(async () => found(sam, unnamed));
    fireEvent.change(screen.getByLabelText("Search members"), { target: { value: "s" } });
    fireEvent.change(screen.getByLabelText("Search members"), { target: { value: "sa" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
    });
    expect(s.service.search).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(s.service.search).toHaveBeenCalledTimes(1);
    expect(s.service.search).toHaveBeenCalledWith("sa");
    expect(screen.getByText("Sam Lee")).toBeTruthy();
    expect(screen.getByText("Member 0042")).toBeTruthy();
    expect(screen.getByText("Member 0043")).toBeTruthy();
    expect(screen.getByText("Check in Sam Lee")).toBeTruthy();
    expect(screen.getByText("Check in member")).toBeTruthy();
  });

  it("shows the no results state", async () => {
    mount(async () => found());
    await type(" zed ");
    expect(screen.getByText('No one matches "zed"')).toBeTruthy();
  });

  it("shows a loading state, then an error that can be retried", async () => {
    let answer: (result: SearchResult) => void = () => undefined;
    const s = mount(() => new Promise<SearchResult>((resolve) => (answer = resolve)));
    await type("sam");
    expect(screen.getByLabelText("Loading")).toBeTruthy();
    await act(async () => answer({ status: "failed", message: "Offline" }));
    expect(screen.getByText("Offline")).toBeTruthy();
    fireEvent.click(screen.getByText("Try again"));
    expect(s.service.search).toHaveBeenCalledTimes(2);
    await act(async () => answer(found(sam)));
    expect(screen.getByText("Sam Lee")).toBeTruthy();
  });

  it("drops an older answer that arrives after a newer one", async () => {
    const answers: ((result: SearchResult) => void)[] = [];
    mount(() => new Promise<SearchResult>((resolve) => answers.push(resolve)));
    await type("sa");
    await type("sam");
    await act(async () => answers[1]?.(found(sam)));
    await act(async () => answers[0]?.(found(unnamed)));
    expect(screen.getByText("Sam Lee")).toBeTruthy();
    expect(screen.queryByText("Member 0043")).toBeNull();
  });

  it("goes back to the empty prompt when the text is cleared", async () => {
    mount(async () => found(sam));
    await type("sam");
    await type("");
    expect(screen.getByText("Search for a member")).toBeTruthy();
  });

  it("makes one check in for a double tap and disables every button while it runs", async () => {
    let done: () => void = () => undefined;
    const s = mount(
      async () => found(sam, unnamed),
      () => new Promise<void>((resolve) => (done = resolve)),
    );
    await type("sa");
    const button = screen.getByText("Check in Sam Lee");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(s.check).toHaveBeenCalledTimes(1);
    expect(s.check).toHaveBeenCalledWith(sam);
    expect(screen.getByText("Checking in")).toBeTruthy();
    expect(screen.getByText("Check in member").closest("button")?.disabled).toBe(true);
    expect(screen.getByText("Back to scanner").closest("button")?.disabled).toBe(true);
    await act(async () => done());
    expect(screen.getByText("Check in Sam Lee")).toBeTruthy();
    fireEvent.click(screen.getByText("Check in Sam Lee"));
    expect(s.check).toHaveBeenCalledTimes(2);
  });

  it("does not update after the screen is gone", async () => {
    let done: () => void = () => undefined;
    const s = mount(
      async () => found(sam),
      () => new Promise<void>((resolve) => (done = resolve)),
    );
    await type("sam");
    fireEvent.click(screen.getByText("Check in Sam Lee"));
    s.view.unmount();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await act(async () => done());
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("goes back", () => {
    const s = mount(async () => found());
    fireEvent.click(screen.getByText("Back to scanner"));
    expect(s.onBack).toHaveBeenCalledTimes(1);
  });
});
