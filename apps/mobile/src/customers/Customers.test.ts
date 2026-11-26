import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Customers, SEARCH_DELAY_MS } from "./Customers";
import { CustomersProvider, useCustomersService } from "./context";
import type { CustomerPage, CustomerRow, CustomersService } from "./list";
import { useCustomers } from "./useCustomers";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const row = (id: string, over: Partial<CustomerRow> = {}): CustomerRow => ({
  id,
  name: `Person ${id}`,
  status: "ACTIVE",
  standing: "PAID",
  paidThrough: "2026-12-13",
  balanceDue: 0,
  visitsThisMonth: 9,
  visitsLastMonth: 14,
  totalPaid: 105000,
  currency: "USD",
  ...over,
});

const ok = (items: CustomerRow[], nextCursor: string | null = null): CustomerPage => ({
  status: "page",
  items,
  nextCursor,
});

function mount(fetch: CustomersService["fetch"]) {
  const service = { fetch: vi.fn(fetch) };
  const view = render(createElement(CustomersProvider, { service }, createElement(Customers)));
  return { service, view };
}

const settle = () => act(async () => {});

describe("Customers", () => {
  it("shows loading, then each row as the server sent it", async () => {
    mount(async () =>
      ok([row("b", { standing: "OVERDUE", balanceDue: 8000, paidThrough: null }), row("a")]),
    );
    expect(screen.getByLabelText("Loading")).toBeTruthy();
    await settle();
    const names = screen.getAllByText(/^Person /).map((n) => n.textContent);
    expect(names).toEqual(["Person b", "Person a"]);
    expect(screen.getByText("Not paid yet")).toBeTruthy();
    expect(screen.getByText("Overdue")).toBeTruthy();
    expect(screen.getByText("$80.00")).toBeTruthy();
    expect(screen.getAllByText("9 / 14").length).toBe(2);
    expect(screen.getAllByText("$1,050.00").length).toBe(2);
    expect(screen.getByText("Overdue first")).toBeTruthy();
  });

  it("falls back to a generic name for a customer without one", async () => {
    mount(async () => ok([row("a", { name: null })]));
    await settle();
    expect(screen.getByText("Customer")).toBeTruthy();
  });

  it("shows the empty state with an add button", async () => {
    mount(async () => ok([]));
    await settle();
    expect(screen.getByText("No customers yet")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Add member"));
    expect(screen.getByText("Add member")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Back to customers"));
    expect(screen.getByText("Customers")).toBeTruthy();
  });

  it("shows the error state and retries", async () => {
    const fetch = vi
      .fn<CustomersService["fetch"]>()
      .mockResolvedValueOnce({ status: "failed", message: "x" })
      .mockResolvedValueOnce(ok([row("a")]));
    mount(fetch);
    await settle();
    expect(screen.getByText("Could not load customers")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Try again"));
    await settle();
    expect(screen.getByText("Person a")).toBeTruthy();
  });

  it("opens a customer and goes back", async () => {
    mount(async () => ok([row("a")]));
    await settle();
    fireEvent.click(screen.getByLabelText("Open Person a"));
    expect(screen.getByText("This screen is built in a later ticket.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Back to customers"));
    expect(screen.getByText("Person a")).toBeTruthy();
  });

  it("has an Add button in the header", async () => {
    mount(async () => ok([row("a")]));
    await settle();
    fireEvent.click(screen.getByLabelText("Add"));
    expect(screen.getByText("Add member")).toBeTruthy();
  });

  it("pages with the cursor and stops at the end", async () => {
    const fetch = vi
      .fn<CustomersService["fetch"]>()
      .mockResolvedValueOnce(ok([row("a")], "c1"))
      .mockResolvedValueOnce(ok([row("b")], null));
    mount(fetch);
    await settle();
    fireEvent.click(screen.getByLabelText("Reach the end"));
    await settle();
    expect(fetch).toHaveBeenLastCalledWith({ search: "", cursor: "c1" });
    expect(screen.getAllByText(/^Person /).map((n) => n.textContent)).toEqual([
      "Person a",
      "Person b",
    ]);
    fireEvent.click(screen.getByLabelText("Reach the end"));
    await settle();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not ask for the next page twice at once, and keeps the list if it fails", async () => {
    let finish!: (p: CustomerPage) => void;
    const fetch = vi
      .fn<CustomersService["fetch"]>()
      .mockResolvedValueOnce(ok([row("a")], "c1"))
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            finish = r;
          }),
      );
    mount(fetch);
    await settle();
    fireEvent.click(screen.getByLabelText("Reach the end"));
    fireEvent.click(screen.getByLabelText("Reach the end"));
    expect(fetch).toHaveBeenCalledTimes(2);
    await act(async () => finish({ status: "failed", message: "x" }));
    expect(screen.getByText("Person a")).toBeTruthy();
  });

  it("refreshes from the top", async () => {
    const fetch = vi
      .fn<CustomersService["fetch"]>()
      .mockResolvedValueOnce(ok([row("a")]))
      .mockResolvedValueOnce(ok([row("z")]));
    mount(fetch);
    await settle();
    fireEvent.click(screen.getByLabelText("Pull to refresh"));
    expect(screen.getByTestId("list").getAttribute("data-refreshing")).toBe("true");
    await settle();
    expect(screen.getByText("Person z")).toBeTruthy();
    expect(screen.getByTestId("list").getAttribute("data-refreshing")).toBe("false");
  });

  it("debounces the search and sends only the last text", async () => {
    const fetch = vi.fn<CustomersService["fetch"]>(async () => ok([row("a")]));
    mount(fetch);
    await settle();
    const box = screen.getByLabelText("Search customers");
    fireEvent.change(box, { target: { value: "l" } });
    fireEvent.change(box, { target: { value: "le" } });
    fireEvent.change(box, { target: { value: "lee" } });
    await act(async () => vi.advanceTimersByTime(SEARCH_DELAY_MS - 1));
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith({ search: "lee" });
  });

  it("never lets an older response overwrite a newer one", async () => {
    const resolvers: Record<string, (p: CustomerPage) => void> = {};
    const fetch = vi.fn<CustomersService["fetch"]>(
      ({ search }) =>
        new Promise((r) => {
          resolvers[search] = r;
        }),
    );
    mount(fetch);
    await act(async () => {});
    fireEvent.change(screen.getByLabelText("Search customers"), { target: { value: "new" } });
    await act(async () => vi.advanceTimersByTime(SEARCH_DELAY_MS));
    await act(async () => resolvers.new?.(ok([row("new")])));
    await act(async () => resolvers[""]?.(ok([row("old")])));
    expect(screen.getByText("Person new")).toBeTruthy();
    expect(screen.queryByText("Person old")).toBeNull();
  });

  it("drops a next page that belongs to an older search", async () => {
    let finish!: (p: CustomerPage) => void;
    const fetch = vi.fn<CustomersService["fetch"]>(async ({ search, cursor }) => {
      if (cursor !== undefined)
        return new Promise((r) => {
          finish = r;
        });
      return ok([row(search === "" ? "a" : "b")], search === "" ? "c1" : null);
    });
    mount(fetch);
    await settle();
    fireEvent.click(screen.getByLabelText("Reach the end"));
    fireEvent.change(screen.getByLabelText("Search customers"), { target: { value: "x" } });
    await act(async () => vi.advanceTimersByTime(SEARCH_DELAY_MS));
    await act(async () => finish(ok([row("late")], null)));
    expect(screen.queryByText("Person late")).toBeNull();
    expect(screen.getByText("Person b")).toBeTruthy();
  });

  it("says when a search finds no one", async () => {
    const fetch = vi.fn<CustomersService["fetch"]>(async ({ search }) =>
      ok(search === "" ? [row("a")] : []),
    );
    mount(fetch);
    await settle();
    fireEvent.change(screen.getByLabelText("Search customers"), { target: { value: "zz" } });
    await act(async () => vi.advanceTimersByTime(SEARCH_DELAY_MS));
    expect(screen.getByText('No one matches "zz"')).toBeTruthy();
  });

  it("ignores an answer that arrives after unmount", async () => {
    let finish!: (p: CustomerPage) => void;
    const { view } = mount(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    view.unmount();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => finish(ok([row("a")])));
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("needs a CustomersProvider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useCustomersService())).toThrow("CustomersProvider");
  });
});

describe("useCustomers", () => {
  it("does nothing on loadMore before the first page", async () => {
    const service = { fetch: vi.fn(() => new Promise<CustomerPage>(() => {})) };
    const { result } = renderHook(() => useCustomers(service, ""));
    act(() => result.current.loadMore());
    expect(service.fetch).toHaveBeenCalledTimes(1);
  });
});
