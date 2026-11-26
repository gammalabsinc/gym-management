import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomerDetail, FORBIDDEN_MESSAGE } from "./CustomerDetail";
import { DetailProvider, useDetailService } from "./context";
import { AMOUNT_ZERO, DISCOUNT_NOTE, readAmount } from "./DiscountSheet";
import { REASON_MAX, REASON_REQUIRED, REASON_TOO_LONG } from "./ReasonSheet";
import type {
  ActionResult,
  DetailHeader,
  DetailService,
  InvoiceRow,
  Page,
  PaymentRow,
} from "./service";

afterEach(cleanup);

const header: DetailHeader = {
  memberId: "m1",
  memberNo: "0042",
  name: "Sam Lee",
  planName: "Monthly",
  status: "ACTIVE",
  standing: "OVERDUE",
  paidThrough: "2026-10-31",
  balanceDue: 7000,
  credit: 1500,
  currency: "USD",
  timezone: "UTC",
};

const invoice = (id: string, over: Partial<InvoiceRow> = {}): InvoiceRow => ({
  id,
  periodStart: "2026-11-01",
  periodEnd: "2026-11-30",
  dueDate: "2026-11-01",
  total: 3000,
  amountDue: 3000,
  isPaid: false,
  isVoid: false,
  voidReason: null,
  ...over,
});

const payment = (id: string, over: Partial<PaymentRow> = {}): PaymentRow => ({
  id,
  amount: 3000,
  method: "BANK_TRANSFER",
  paidOn: "2026-11-05",
  isVoid: false,
  voidReason: null,
  ...over,
});

const page = <Row>(items: Row[], nextCursor: string | null = null): Page<Row> => ({
  status: "page",
  items,
  nextCursor,
});

function fake(over: Partial<DetailService> = {}): DetailService {
  return {
    header: vi.fn(async () => ({ status: "data" as const, header })),
    invoices: vi.fn(() => async () => page([invoice("i1")])),
    payments: vi.fn(() => async () => page([payment("p1")])),
    visits: vi.fn(
      () => async () =>
        page([
          {
            id: "v1",
            scannedAt: "2026-11-20T10:00:00Z",
            isDuplicate: false,
            source: "STAFF_APP" as const,
          },
          {
            id: "v2",
            scannedAt: "2026-11-20T10:05:00Z",
            isDuplicate: true,
            source: "MANUAL" as const,
          },
        ]),
    ),
    discounts: vi.fn(
      () => async () =>
        page([
          {
            id: "d1",
            kind: "MANUAL" as const,
            amount: 500,
            isRecurring: true,
            reason: "Loyalty",
            isActive: true,
            isConsumed: false,
            startsOn: "2026-11-01",
            endsOn: null,
          },
          {
            id: "d2",
            kind: "REFERRAL" as const,
            amount: 1000,
            isRecurring: false,
            reason: null,
            isActive: false,
            isConsumed: true,
            startsOn: "2026-10-01",
            endsOn: "2026-10-31",
          },
          {
            id: "d3",
            kind: "MANUAL" as const,
            amount: 100,
            isRecurring: true,
            reason: null,
            isActive: false,
            isConsumed: false,
            startsOn: "2026-09-01",
            endsOn: "2026-09-30",
          },
        ]),
    ),
    history: vi.fn(
      () => async () =>
        page([
          {
            id: "h1",
            status: "PAUSED" as const,
            validFrom: "2026-11-10",
            validTo: null,
            reason: "Away",
          },
          {
            id: "h0",
            status: "ACTIVE" as const,
            validFrom: "2026-01-01",
            validTo: "2026-11-10",
            reason: null,
          },
          {
            id: "hc",
            status: "CANCELLED" as const,
            validFrom: "2025-01-01",
            validTo: "2025-02-01",
            reason: null,
          },
        ]),
    ),
    changeStatus: vi.fn(async (): Promise<ActionResult> => ({ status: "done" })),
    voidPayment: vi.fn(async (): Promise<ActionResult> => ({ status: "done" })),
    voidInvoice: vi.fn(async (): Promise<ActionResult> => ({ status: "done" })),
    addDiscount: vi.fn(async (): Promise<ActionResult> => ({ status: "done" })),
    endDiscount: vi.fn(async (): Promise<ActionResult> => ({ status: "done" })),
    ...over,
  };
}

function mount(service: DetailService, viewer: "staff" | "owner" = "owner") {
  const props = {
    id: "m1",
    viewer,
    onBack: vi.fn(),
    onRecordPayment: vi.fn(),
    onEdit: vi.fn(),
  };
  const view = render(
    createElement(DetailProvider, { service }, createElement(CustomerDetail, props)),
  );
  return { ...props, view };
}

function Probe() {
  useDetailService();
  return null;
}

const settle = () => act(async () => {});
const open = async (tab: string) => {
  fireEvent.click(screen.getByText(tab));
  await settle();
};
const fill = (reason: string) =>
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: reason } });

describe("CustomerDetail header", () => {
  it("shows the figures and the buttons", async () => {
    const m = mount(fake());
    expect(screen.getByLabelText("Loading")).toBeTruthy();
    await settle();
    expect(screen.getByText("Sam Lee")).toBeTruthy();
    expect(screen.getByText("Member 0042, Monthly")).toBeTruthy();
    expect(screen.getByText("Overdue")).toBeTruthy();
    expect(screen.getByText("$70.00")).toBeTruthy();
    expect(screen.getByText("Oct 31, 2026")).toBeTruthy();
    expect(screen.getByText("$15.00")).toBeTruthy();
    fireEvent.click(screen.getByText("Record payment"));
    expect(m.onRecordPayment).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Back to customers"));
    expect(m.onBack).toHaveBeenCalledTimes(1);
  });

  it("copes with a customer who has no name and has not paid", async () => {
    mount(
      fake({
        header: async () => ({
          status: "data",
          header: { ...header, name: null, paidThrough: null },
        }),
      }),
    );
    await settle();
    expect(screen.getByText("Customer")).toBeTruthy();
    expect(screen.getByText("Not paid yet")).toBeTruthy();
  });

  it("shows a failed header with a retry", async () => {
    const load = vi
      .fn<DetailService["header"]>()
      .mockResolvedValueOnce({ status: "failed", message: "Offline" })
      .mockResolvedValueOnce({ status: "data", header });
    mount(fake({ header: load }));
    await settle();
    expect(screen.getByText("Offline")).toBeTruthy();
    fireEvent.click(screen.getByText("Try again"));
    await settle();
    expect(screen.getByText("Sam Lee")).toBeTruthy();
  });

  it("drops a header answer that arrives after the screen is gone", async () => {
    let answer: (value: Awaited<ReturnType<DetailService["header"]>>) => void = () => undefined;
    const m = mount(fake({ header: () => new Promise((resolve) => (answer = resolve)) }));
    m.view.unmount();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await act(async () => answer({ status: "data", header }));
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("needs a provider", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(createElement(Probe))).toThrow("DetailProvider");
    error.mockRestore();
  });
});

describe("CustomerDetail tabs", () => {
  it("shows invoices first, with each tab loading on its own", async () => {
    const service = fake();
    mount(service);
    await settle();
    expect(screen.getByText("Total $30.00, due $30.00")).toBeTruthy();
    expect(screen.getByText("Unpaid")).toBeTruthy();
    expect(service.payments).toHaveBeenCalledTimes(1);

    await open("Payments");
    expect(screen.getByText("$30.00 by Bank transfer")).toBeTruthy();
    expect(screen.getByText("Received Nov 5, 2026")).toBeTruthy();

    await open("Visits");
    expect(screen.getByText("Nov 20, 2026, 10:00 AM")).toBeTruthy();
    expect(screen.getByText("Repeat scan")).toBeTruthy();
    expect(screen.getByText("Checked in from a search")).toBeTruthy();
    expect(screen.getByText("Scanned at the desk")).toBeTruthy();

    await open("Discounts");
    expect(screen.getByText("$5.00 off, every month")).toBeTruthy();
    expect(screen.getByText("$10.00 off, one time")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Used")).toBeTruthy();
    expect(screen.getByText("Ended")).toBeTruthy();
    expect(screen.getByText("Referral discount")).toBeTruthy();
    expect(screen.getByText("Loyalty")).toBeTruthy();

    await open("History");
    expect(screen.getByText("Current")).toBeTruthy();
    expect(screen.getByText("Away")).toBeTruthy();
    expect(screen.getByText("From Nov 10, 2026")).toBeTruthy();
    expect(screen.getByText("From Jan 1, 2026 to Nov 10, 2026")).toBeTruthy();
  });

  it("shows paid, voided and reasoned rows", async () => {
    mount(
      fake({
        invoices: () => async () =>
          page([
            invoice("i1", { isPaid: true, amountDue: 0 }),
            invoice("i2", { isVoid: true, voidReason: "Entered twice" }),
          ]),
        payments: () => async () =>
          page([payment("p1", { isVoid: true, voidReason: "Bounced", method: "CARD" })]),
      }),
    );
    await settle();
    expect(screen.getByText("Paid")).toBeTruthy();
    expect(screen.getByText("Voided: Entered twice")).toBeTruthy();
    await open("Payments");
    expect(screen.getByText("Voided: Bounced")).toBeTruthy();
    expect(screen.getByText("$30.00 by Card")).toBeTruthy();
  });

  it("shows each empty state and an error with retry", async () => {
    const empty = () => async () => page([]);
    const load = vi
      .fn<(cursor?: string) => Promise<Page<PaymentRow>>>()
      .mockResolvedValueOnce({ status: "failed", message: "Offline" })
      .mockResolvedValueOnce(page([payment("p1")]));
    mount(
      fake({
        invoices: empty,
        payments: () => load,
        visits: empty,
        discounts: empty,
        history: empty,
      }),
    );
    await settle();
    expect(screen.getByText("No invoices yet")).toBeTruthy();
    await open("Visits");
    expect(screen.getByText("No visits yet")).toBeTruthy();
    await open("Discounts");
    expect(screen.getByText("No discounts")).toBeTruthy();
    await open("History");
    expect(screen.getByText("No history yet")).toBeTruthy();
    await open("Payments");
    expect(screen.getByText("Offline")).toBeTruthy();
    fireEvent.click(screen.getByText("Try again"));
    await settle();
    expect(screen.getByText("$30.00 by Bank transfer")).toBeTruthy();
  });

  it("pages a tab on its own, and keeps the rows when a later page fails", async () => {
    const load = vi
      .fn<(cursor?: string) => Promise<Page<InvoiceRow>>>()
      .mockResolvedValueOnce(page([invoice("i1")], "c2"))
      .mockResolvedValueOnce({ status: "failed", message: "Offline" })
      .mockResolvedValueOnce(page([invoice("i2", { total: 4000, amountDue: 4000 })], null));
    mount(fake({ invoices: () => load }));
    await settle();
    fireEvent.click(screen.getByText("Load more"));
    await settle();
    expect(screen.getByText("Total $30.00, due $30.00")).toBeTruthy();
    fireEvent.click(screen.getByText("Load more"));
    await settle();
    expect(load).toHaveBeenLastCalledWith("c2");
    expect(screen.getByText("Total $40.00, due $40.00")).toBeTruthy();
    expect(screen.queryByText("Load more")).toBeNull();
  });

  it("asks for a page only once while it loads", async () => {
    let answer: (value: Page<InvoiceRow>) => void = () => undefined;
    const load = vi
      .fn<(cursor?: string) => Promise<Page<InvoiceRow>>>()
      .mockResolvedValueOnce(page([invoice("i1")], "c2"))
      .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    mount(fake({ invoices: () => load }));
    await settle();
    fireEvent.click(screen.getByText("Load more"));
    fireEvent.click(screen.getByText("Loading"));
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => answer(page([])));
  });

  it("drops a page that arrives after the tab was left", async () => {
    let answer: (value: Page<InvoiceRow>) => void = () => undefined;
    const load = vi
      .fn<(cursor?: string) => Promise<Page<InvoiceRow>>>()
      .mockResolvedValueOnce(page([invoice("i1")], "c2"))
      .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    mount(fake({ invoices: () => load }));
    await settle();
    fireEvent.click(screen.getByText("Load more"));
    await open("Payments");
    await act(async () => answer(page([invoice("i9", { total: 9900, amountDue: 9900 })])));
    expect(screen.queryByText("Total $99.00, due $99.00")).toBeNull();
  });
});

describe("CustomerDetail actions", () => {
  it("offers pause for an active member, and edit", async () => {
    const m = mount(fake());
    await settle();
    expect(screen.queryByText("Pause")).toBeNull();
    fireEvent.click(screen.getByText("More actions"));
    expect(screen.getByText("Pause")).toBeTruthy();
    expect(screen.queryByText("Resume")).toBeNull();
    expect(screen.getByText("Cancel membership")).toBeTruthy();
    fireEvent.click(screen.getByText("Edit"));
    expect(m.onEdit).toHaveBeenCalledTimes(1);
  });

  it("offers resume for a paused member and nothing but edit for a cancelled one", async () => {
    const paused = fake({
      header: async () => ({ status: "data", header: { ...header, status: "PAUSED" } }),
    });
    mount(paused);
    await settle();
    fireEvent.click(screen.getByText("More actions"));
    expect(screen.getByText("Resume")).toBeTruthy();
    expect(screen.queryByText("Pause")).toBeNull();
    cleanup();
    mount(
      fake({
        header: async () => ({ status: "data", header: { ...header, status: "CANCELLED" } }),
      }),
    );
    await settle();
    fireEvent.click(screen.getByText("More actions"));
    expect(screen.getByText("Edit")).toBeTruthy();
    expect(screen.queryByText("Pause")).toBeNull();
    expect(screen.queryByText("Resume")).toBeNull();
    expect(screen.queryByText("Cancel membership")).toBeNull();
  });

  it("needs a reason before it pauses, then reloads the header and the tab from the server", async () => {
    const service = fake();
    mount(service);
    await settle();
    fireEvent.click(screen.getByText("More actions"));
    fireEvent.click(screen.getByText("Pause"));
    expect(screen.getByText("Pause membership?")).toBeTruthy();
    const confirm = screen.getByText("Pause membership").closest("button");
    expect(confirm?.disabled).toBe(true);
    fill("   ");
    expect(screen.getByText(REASON_REQUIRED)).toBeTruthy();
    expect(confirm?.disabled).toBe(true);
    fill("  Away for a month ");
    expect(confirm?.disabled).toBe(false);
    fireEvent.click(screen.getByText("Pause membership"));
    await settle();
    expect(service.changeStatus).toHaveBeenCalledWith("m1", "PAUSED", "Away for a month");
    expect(service.header).toHaveBeenCalledTimes(2);
    expect(service.invoices).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Pause membership?")).toBeNull();
  });

  it("confirms a cancel first and says what it ends", async () => {
    const service = fake();
    mount(service);
    await settle();
    fireEvent.click(screen.getByText("More actions"));
    fireEvent.click(screen.getByText("Cancel membership"));
    expect(screen.getByText("Cancel membership?")).toBeTruthy();
    expect(screen.getByText(/ends this membership for good/)).toBeTruthy();
    expect(service.changeStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Cancel membership?")).toBeNull();
    expect(service.changeStatus).not.toHaveBeenCalled();
  });

  it("cancels and resumes with the right status", async () => {
    const service = fake();
    mount(service);
    await settle();
    fireEvent.click(screen.getByText("More actions"));
    fireEvent.click(screen.getByText("Cancel membership"));
    fill("Moved away");
    fireEvent.click(screen.getByText("Cancel membership", { selector: "span" }));
    await settle();
    expect(service.changeStatus).toHaveBeenCalledWith("m1", "CANCELLED", "Moved away");
  });

  it("resumes a paused member", async () => {
    const service = fake({
      header: async () => ({ status: "data", header: { ...header, status: "PAUSED" } }),
    });
    mount(service);
    await settle();
    fireEvent.click(screen.getByText("More actions"));
    fireEvent.click(screen.getByText("Resume"));
    fill("Back");
    fireEvent.click(screen.getByText("Resume membership"));
    await settle();
    expect(service.changeStatus).toHaveBeenCalledWith("m1", "ACTIVE", "Back");
  });

  it("rejects a reason that is too long before asking the server", async () => {
    const service = fake();
    mount(service);
    await settle();
    fireEvent.click(screen.getByText("More actions"));
    fireEvent.click(screen.getByText("Pause"));
    fill("x".repeat(REASON_MAX + 1));
    expect(screen.getByText(REASON_TOO_LONG)).toBeTruthy();
    expect(screen.getByText("Pause membership").closest("button")?.disabled).toBe(true);
  });

  it("keeps the sheet open with the server's message when the change is invalid or fails", async () => {
    const results: ActionResult[] = [
      { status: "invalid", message: "Reason is required" },
      { status: "failed", message: "Offline" },
    ];
    const service = fake({ changeStatus: vi.fn(async () => results.shift() as ActionResult) });
    mount(service);
    await settle();
    fireEvent.click(screen.getByText("More actions"));
    fireEvent.click(screen.getByText("Pause"));
    fill("Away");
    fireEvent.click(screen.getByText("Pause membership"));
    await settle();
    expect(screen.getByText("Reason is required")).toBeTruthy();
    fireEvent.click(screen.getByText("Pause membership"));
    await settle();
    expect(screen.getByText("Offline")).toBeTruthy();
    expect(service.header).toHaveBeenCalledTimes(1);
  });

  it("shows saving and keeps the buttons off while the change is in flight", async () => {
    let finish: (result: ActionResult) => void = () => undefined;
    const service = fake({
      changeStatus: vi.fn(() => new Promise<ActionResult>((resolve) => (finish = resolve))),
    });
    mount(service);
    await settle();
    fireEvent.click(screen.getByText("More actions"));
    fireEvent.click(screen.getByText("Pause"));
    fill("Away");
    fireEvent.click(screen.getByText("Pause membership"));
    expect(screen.getByText("Saving").closest("button")?.disabled).toBe(true);
    await act(async () => finish({ status: "done" }));
  });

  it("handles a forbidden answer with a message and no reload", async () => {
    const service = fake({ changeStatus: vi.fn(async () => ({ status: "forbidden" as const })) });
    mount(service);
    await settle();
    fireEvent.click(screen.getByText("More actions"));
    fireEvent.click(screen.getByText("Pause"));
    fill("Away");
    fireEvent.click(screen.getByText("Pause membership"));
    await settle();
    expect(screen.getByText(FORBIDDEN_MESSAGE)).toBeTruthy();
    expect(screen.queryByText("Pause membership?")).toBeNull();
    expect(service.header).toHaveBeenCalledTimes(1);
  });

  it("shows the server's reason and loads the truth again when the change was refused", async () => {
    const service = fake({
      changeStatus: vi.fn(async () => ({ status: "refused" as const, message: "Already paused" })),
    });
    mount(service);
    await settle();
    fireEvent.click(screen.getByText("More actions"));
    fireEvent.click(screen.getByText("Pause"));
    fill("Away");
    fireEvent.click(screen.getByText("Pause membership"));
    await settle();
    expect(screen.getByText("Already paused")).toBeTruthy();
    expect(service.header).toHaveBeenCalledTimes(2);
  });

  it("ignores a change that finishes after the screen is gone", async () => {
    let finish: (result: ActionResult) => void = () => undefined;
    const service = fake({
      changeStatus: vi.fn(() => new Promise<ActionResult>((resolve) => (finish = resolve))),
    });
    const m = mount(service);
    await settle();
    fireEvent.click(screen.getByText("More actions"));
    fireEvent.click(screen.getByText("Pause"));
    fill("Away");
    fireEvent.click(screen.getByText("Pause membership"));
    m.view.unmount();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await act(async () => finish({ status: "done" }));
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("CustomerDetail voids", () => {
  it("gives owners void buttons, and only for invoices with no payment applied", async () => {
    mount(
      fake({
        invoices: () => async () =>
          page([
            invoice("i1"),
            invoice("i2", { amountDue: 1000 }),
            invoice("i3", { isPaid: true, amountDue: 0 }),
            invoice("i4", { isVoid: true, voidReason: "x" }),
          ]),
      }),
    );
    await settle();
    expect(screen.getAllByText(/^Void invoice due/).length).toBe(1);
  });

  it("voids an invoice with a reason, then reloads", async () => {
    const service = fake();
    mount(service);
    await settle();
    fireEvent.click(screen.getByText("Void invoice due Nov 1, 2026"));
    expect(screen.getByText("Void this invoice?")).toBeTruthy();
    fill("Entered twice");
    fireEvent.click(screen.getByText("Void invoice"));
    await settle();
    expect(service.voidInvoice).toHaveBeenCalledWith("i1", "Entered twice");
    expect(service.header).toHaveBeenCalledTimes(2);
  });

  it("voids a payment with a reason, and shows no void for one already voided", async () => {
    const service = fake({
      payments: () => async () =>
        page([payment("p1"), payment("p2", { isVoid: true, voidReason: "x" })]),
    });
    mount(service);
    await settle();
    await open("Payments");
    expect(screen.getAllByText(/^Void payment of/).length).toBe(1);
    fireEvent.click(screen.getByText("Void payment of Nov 5, 2026"));
    expect(screen.getByText("Void this payment?")).toBeTruthy();
    fill("Bounced");
    fireEvent.click(screen.getByText("Void payment"));
    await settle();
    expect(service.voidPayment).toHaveBeenCalledWith("p1", "Bounced");
  });

  it("shows no void buttons to staff", async () => {
    mount(fake(), "staff");
    await settle();
    expect(screen.queryByText(/^Void invoice due/)).toBeNull();
    await open("Payments");
    expect(screen.queryByText(/^Void payment of/)).toBeNull();
  });

  it("still handles a forbidden void for an owner whose role just changed", async () => {
    const service = fake({ voidPayment: vi.fn(async () => ({ status: "forbidden" as const })) });
    mount(service);
    await settle();
    await open("Payments");
    fireEvent.click(screen.getByText("Void payment of Nov 5, 2026"));
    fill("Bounced");
    fireEvent.click(screen.getByText("Void payment"));
    await settle();
    expect(screen.getByText(FORBIDDEN_MESSAGE)).toBeTruthy();
  });
});

/** A service whose discounts loader counts how many times the tab was loaded. */
function withCountedDiscounts(over: Partial<DetailService> = {}) {
  const load = vi.fn(fake().discounts("m1"));
  return { load, service: fake({ discounts: () => load, ...over }) };
}

describe("CustomerDetail discounts", () => {
  const typeInto = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const openAdd = async (service: DetailService) => {
    mount(service);
    await settle();
    await open("Discounts");
    fireEvent.click(screen.getByLabelText("Add discount"));
  };
  const saveButton = () => screen.getAllByLabelText("Add discount").at(-1) as HTMLButtonElement;

  it("shows Add and End to owners only, and End only for a running monthly manual discount", async () => {
    mount(fake());
    await settle();
    await open("Discounts");
    expect(screen.getByLabelText("Add discount")).toBeTruthy();
    // d1 is manual, monthly and active. d2 is referral and d3 has ended.
    expect(screen.getAllByText(/^End discount of/).length).toBe(1);
    expect(screen.getByText("End discount of $5.00")).toBeTruthy();
  });

  it("shows neither to staff", async () => {
    mount(fake(), "staff");
    await settle();
    await open("Discounts");
    expect(screen.queryByLabelText("Add discount")).toBeNull();
    expect(screen.queryByText(/^End discount of/)).toBeNull();
  });

  it("keeps Save off until the amount and the reason are right", async () => {
    await openAdd(fake());
    expect(saveButton().disabled).toBe(true);
    typeInto("Amount", "5.00");
    expect(saveButton().disabled).toBe(true);
    typeInto("Reason", "Loyalty");
    expect(saveButton().disabled).toBe(false);
    typeInto("Amount", "0");
    expect(screen.getByText(AMOUNT_ZERO)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    typeInto("Amount", "5.005");
    expect(screen.getByText("Use at most 2 decimal places.")).toBeTruthy();
    typeInto("Amount", "5");
    typeInto("Reason", "   ");
    expect(screen.getByText(REASON_REQUIRED)).toBeTruthy();
    typeInto("Reason", "x".repeat(REASON_MAX + 1));
    expect(screen.getByText(REASON_TOO_LONG)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it("saves a one time discount in minor units, says when it starts, and reloads the list", async () => {
    const { service, load } = withCountedDiscounts();
    await openAdd(service);
    expect(screen.getByText(DISCOUNT_NOTE)).toBeTruthy();
    typeInto("Amount", "12.50");
    typeInto("Reason", "  Goodwill ");
    fireEvent.click(saveButton());
    await settle();
    expect(service.addDiscount).toHaveBeenCalledWith("m1", {
      amount: 1250,
      isRecurring: false,
      reason: "Goodwill",
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(service.header).toHaveBeenCalledTimes(2);
    expect(screen.getByText(DISCOUNT_NOTE)).toBeTruthy();
    expect(screen.queryByLabelText("Cancel")).toBeNull();
  });

  it("saves a monthly discount when Every month is chosen", async () => {
    const service = fake();
    await openAdd(service);
    typeInto("Amount", "3");
    typeInto("Reason", "Staff rate");
    fireEvent.click(screen.getByLabelText("Every month"));
    fireEvent.click(saveButton());
    await settle();
    expect(service.addDiscount).toHaveBeenCalledWith("m1", {
      amount: 300,
      isRecurring: true,
      reason: "Staff rate",
    });
  });

  it("can switch back to One time before saving", async () => {
    const service = fake();
    await openAdd(service);
    typeInto("Amount", "3");
    typeInto("Reason", "Staff rate");
    fireEvent.click(screen.getByLabelText("Every month"));
    fireEvent.click(screen.getByLabelText("One time"));
    fireEvent.click(saveButton());
    await settle();
    expect(service.addDiscount).toHaveBeenCalledWith(
      "m1",
      expect.objectContaining({ isRecurring: false }),
    );
  });

  it("ignores a press on Save while the form is not valid", async () => {
    const service = fake();
    await openAdd(service);
    fireEvent.click(saveButton());
    expect(service.addDiscount).not.toHaveBeenCalled();
  });

  it("shows the server's message in the sheet and keeps it open", async () => {
    const service = fake({
      addDiscount: vi.fn(async () => ({ status: "invalid" as const, message: "Too large" })),
    });
    await openAdd(service);
    typeInto("Amount", "9");
    typeInto("Reason", "Because");
    fireEvent.click(saveButton());
    await settle();
    expect(screen.getByText("Too large")).toBeTruthy();
    expect(screen.queryByText(DISCOUNT_NOTE, { selector: "[data-role=summary]" })).toBeNull();
  });

  it("closes the sheet and shows a banner when the owner has lost the role", async () => {
    const service = fake({ addDiscount: vi.fn(async () => ({ status: "forbidden" as const })) });
    await openAdd(service);
    typeInto("Amount", "9");
    typeInto("Reason", "Because");
    fireEvent.click(saveButton());
    await settle();
    expect(screen.getByText(FORBIDDEN_MESSAGE)).toBeTruthy();
  });

  it("cancels the sheet", async () => {
    await openAdd(fake());
    fireEvent.click(screen.getByLabelText("Cancel"));
    expect(screen.queryByLabelText("Amount")).toBeNull();
  });

  it("ends a monthly discount with a reason, then reloads", async () => {
    const { service, load } = withCountedDiscounts();
    mount(service);
    await settle();
    await open("Discounts");
    fireEvent.click(screen.getByText("End discount of $5.00"));
    expect(screen.getByText("End this discount?")).toBeTruthy();
    fill("Member left the offer");
    fireEvent.click(screen.getByLabelText("End discount"));
    await settle();
    expect(service.endDiscount).toHaveBeenCalledWith("d1", "Member left the offer");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shows the server's reason and loads again when the discount changed under the owner", async () => {
    const { service, load } = withCountedDiscounts({
      endDiscount: vi.fn(async () => ({ status: "refused" as const, message: "Already ended" })),
    });
    mount(service);
    await settle();
    await open("Discounts");
    fireEvent.click(screen.getByText("End discount of $5.00"));
    fill("Done");
    fireEvent.click(screen.getByLabelText("End discount"));
    await settle();
    expect(screen.getByText("Already ended")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("readAmount", () => {
  it("returns minor units for a positive amount and a message otherwise", () => {
    expect(readAmount("1,250.50", "USD")).toEqual({ ok: true, minor: 125050 });
    expect(readAmount("0.00", "USD")).toEqual({ ok: false, error: AMOUNT_ZERO });
    expect(readAmount("abc", "USD")).toEqual({ ok: false, error: "Enter an amount, like 50.00." });
  });
});
