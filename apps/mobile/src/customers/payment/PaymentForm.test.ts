import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentProvider, usePaymentService } from "./context";
import { AMOUNT_ZERO, DATE_FUTURE } from "./form";
import { FORBIDDEN_MESSAGE, PaymentForm, PREVIEW_DEBOUNCE_MS } from "./PaymentForm";
import type { PaymentService, PreviewResult, RecordResult, SetupResult } from "./service";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const setup = {
  memberName: "Sam Lee",
  balanceDue: 7000,
  paidThrough: null,
  credit: 0,
  currency: "USD",
  timezone: "Asia/Tokyo",
};

const preview = (
  over: Partial<Extract<PreviewResult, { status: "preview" }>["preview"]> = {},
): PreviewResult => ({
  status: "preview",
  preview: { invoicesCovered: 2, paidThroughAfter: "2026-12-31", creditAfter: 250, ...over },
});

function fake(over: Partial<PaymentService> = {}): PaymentService {
  let count = 0;
  return {
    newRequestId: vi.fn(() => `req-${++count}`),
    load: vi.fn(async (): Promise<SetupResult> => ({ status: "ready", setup })),
    preview: vi.fn(async (): Promise<PreviewResult> => preview()),
    record: vi.fn(async (): Promise<RecordResult> => ({ status: "recorded" })),
    ...over,
  };
}

function mount(service: PaymentService) {
  const props = {
    memberId: "m1",
    // 20:00 UTC on Nov 26 is already Nov 27 in Tokyo.
    now: () => new Date("2026-11-26T20:00:00Z"),
    onCancel: vi.fn(),
    onSaved: vi.fn(),
  };
  const view = render(
    createElement(PaymentProvider, { service }, createElement(PaymentForm, props)),
  );
  return { ...props, view };
}

function Probe() {
  usePaymentService();
  return null;
}

const settle = () => act(async () => {});
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const pause = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS);
  });
const record = () =>
  fireEvent.click(screen.getByText("Record payment", { selector: "button span" }));
const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

describe("PaymentForm", () => {
  it("starts with what is owed, cash and today in the gym's zone, and shows the preview", async () => {
    const service = fake();
    mount(service);
    expect(screen.getByLabelText("Loading")).toBeTruthy();
    await settle();
    expect(screen.getByText("Sam Lee owes $70.00")).toBeTruthy();
    expect(value("Amount")).toBe("70.00");
    expect(value("Date received")).toBe("2026-11-27");
    await pause();
    expect(service.preview).toHaveBeenCalledWith("m1", 7000);
    expect(screen.getByText("Covers 2 invoices")).toBeTruthy();
    expect(screen.getByText("Paid through Dec 31, 2026")).toBeTruthy();
    expect(screen.getByText("Credit left $2.50")).toBeTruthy();
  });

  it("starts empty when nothing is owed, and uses the singular and a missing date", async () => {
    const service = fake({
      load: async () => ({ status: "ready", setup: { ...setup, memberName: null, balanceDue: 0 } }),
      preview: vi.fn(async () => preview({ invoicesCovered: 1, paidThroughAfter: null })),
    });
    mount(service);
    await settle();
    expect(value("Amount")).toBe("");
    expect(screen.getByText("Customer owes $0.00")).toBeTruthy();
    expect(screen.getByText("Enter an amount to see what it covers.")).toBeTruthy();
    type("Amount", "10");
    await pause();
    expect(screen.getByText("Covers 1 invoice")).toBeTruthy();
    expect(screen.getByText("Paid through not yet")).toBeTruthy();
  });

  it("shows the more than owed hint and still previews", async () => {
    const service = fake();
    mount(service);
    await settle();
    expect(screen.queryByText(/more than what is owed/)).toBeNull();
    type("Amount", "100.00");
    expect(screen.getByText(/more than what is owed/)).toBeTruthy();
    await pause();
    expect(service.preview).toHaveBeenLastCalledWith("m1", 10000);
  });

  it("asks for a preview only after a pause, and not for an amount that is not valid", async () => {
    const service = fake();
    mount(service);
    await settle();
    await pause();
    expect(service.preview).toHaveBeenCalledTimes(1);
    type("Amount", "5");
    type("Amount", "50");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_DEBOUNCE_MS - 1);
    });
    expect(service.preview).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(service.preview).toHaveBeenCalledTimes(2);
    type("Amount", "1.234");
    await pause();
    expect(service.preview).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Enter an amount to see what it covers.")).toBeTruthy();
  });

  it("shows checking while the preview loads, and a failed preview does not block saving", async () => {
    let answer: (result: PreviewResult) => void = () => undefined;
    const service = fake({
      preview: vi.fn(() => new Promise<PreviewResult>((resolve) => (answer = resolve))),
    });
    const m = mount(service);
    await settle();
    await pause();
    expect(screen.getByText("Checking")).toBeTruthy();
    await act(async () => answer({ status: "failed", message: "Could not preview" }));
    expect(screen.getByText("Could not preview")).toBeTruthy();
    record();
    await settle();
    expect(service.record).toHaveBeenCalledTimes(1);
    expect(m.onSaved).toHaveBeenCalledTimes(1);
  });

  it("drops an older preview that arrives after a newer one", async () => {
    const answers: ((result: PreviewResult) => void)[] = [];
    const service = fake({
      preview: vi.fn(() => new Promise<PreviewResult>((resolve) => answers.push(resolve))),
    });
    mount(service);
    await settle();
    await pause();
    type("Amount", "20");
    await pause();
    await act(async () => answers[1]?.(preview({ creditAfter: 111 })));
    await act(async () => answers[0]?.(preview({ creditAfter: 999 })));
    expect(screen.getByText("Credit left $1.11")).toBeTruthy();
    expect(screen.queryByText("Credit left $9.99")).toBeNull();
  });

  it("shows a failed load with a retry", async () => {
    const load = vi
      .fn<PaymentService["load"]>()
      .mockResolvedValueOnce({ status: "failed", message: "Offline" })
      .mockResolvedValueOnce({ status: "ready", setup });
    mount(fake({ load }));
    await settle();
    expect(screen.getByText("Offline")).toBeTruthy();
    fireEvent.click(screen.getByText("Try again"));
    await settle();
    expect(screen.getByLabelText("Amount")).toBeTruthy();
  });

  it("records with the method, date and link, and the form's request id", async () => {
    const service = fake();
    const m = mount(service);
    await settle();
    fireEvent.click(screen.getByText("Bank transfer"));
    type("Amount", "30.50");
    type("Date received", "2026-11-20");
    type("Proof link (optional)", " https://x.test/p ");
    record();
    await settle();
    expect(service.record).toHaveBeenCalledWith({
      clientRequestId: "req-1",
      memberId: "m1",
      amount: 3050,
      method: "BANK_TRANSFER",
      paidOn: "2026-11-20",
      proofLink: "https://x.test/p",
    });
    expect(m.onSaved).toHaveBeenCalledTimes(1);
    expect(service.newRequestId).toHaveBeenCalledTimes(1);
  });

  it("checks the fields before any request, including a date in the future and more than two decimals", async () => {
    const service = fake();
    mount(service);
    await settle();
    type("Amount", "10.999");
    type("Date received", "2026-11-28");
    record();
    await settle();
    expect(screen.getByText("Use at most 2 decimal places.")).toBeTruthy();
    expect(screen.getByText(DATE_FUTURE)).toBeTruthy();
    type("Amount", "0");
    record();
    await settle();
    expect(screen.getByText(AMOUNT_ZERO)).toBeTruthy();
    expect(service.record).not.toHaveBeenCalled();
  });

  it("sends the same request id when Save is tapped again after an error", async () => {
    const results: RecordResult[] = [
      { status: "failed", message: "Offline" },
      { status: "recorded" },
    ];
    const service = fake({ record: vi.fn(async () => results.shift() as RecordResult) });
    const m = mount(service);
    await settle();
    record();
    await settle();
    expect(screen.getByText("Offline")).toBeTruthy();
    type("Amount", "60.00");
    record();
    await settle();
    const calls = (service.record as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((call) => call[0].clientRequestId)).toEqual(["req-1", "req-1"]);
    expect(m.onSaved).toHaveBeenCalledTimes(1);
  });

  it("gives a new form a new request id", async () => {
    const service = fake();
    mount(service);
    await settle();
    record();
    await settle();
    cleanup();
    mount(service);
    await settle();
    record();
    await settle();
    const ids = (service.record as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[0].clientRequestId,
    );
    expect(ids).toEqual(["req-1", "req-2"]);
  });

  it("makes one payment for a double tap and shows Saving", async () => {
    let finish: (result: RecordResult) => void = () => undefined;
    const service = fake({
      record: vi.fn(() => new Promise<RecordResult>((resolve) => (finish = resolve))),
    });
    mount(service);
    await settle();
    const save = screen.getByText("Record payment", { selector: "button span" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(service.record).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Saving").closest("button")?.disabled).toBe(true);
    expect(screen.getByText("Cancel").closest("button")?.disabled).toBe(true);
    await act(async () => finish({ status: "recorded" }));
  });

  it("shows the server's field errors and message, forbidden and failures", async () => {
    const results: RecordResult[] = [
      {
        status: "invalid",
        fields: { amount: "Too small", paidOn: "Too early", proofLink: "Bad link" },
        message: "Member is gone",
      },
      { status: "forbidden" },
    ];
    const service = fake({ record: vi.fn(async () => results.shift() as RecordResult) });
    const m = mount(service);
    await settle();
    record();
    await settle();
    expect(screen.getByText("Too small")).toBeTruthy();
    expect(screen.getByText("Too early")).toBeTruthy();
    expect(screen.getByText("Bad link")).toBeTruthy();
    expect(screen.getByText("Member is gone")).toBeTruthy();
    record();
    await settle();
    expect(screen.getByText(FORBIDDEN_MESSAGE)).toBeTruthy();
    expect(m.onSaved).not.toHaveBeenCalled();
  });

  it("goes back without recording", async () => {
    const service = fake();
    const m = mount(service);
    await settle();
    fireEvent.click(screen.getByText("Cancel"));
    expect(m.onCancel).toHaveBeenCalledTimes(1);
    expect(service.record).not.toHaveBeenCalled();
  });

  it("ignores answers that arrive after the screen is gone", async () => {
    let finishLoad: (result: SetupResult) => void = () => undefined;
    const early = mount(
      fake({ load: () => new Promise<SetupResult>((resolve) => (finishLoad = resolve)) }),
    );
    early.view.unmount();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await act(async () => finishLoad({ status: "ready", setup }));
    cleanup();
    let finish: (result: RecordResult) => void = () => undefined;
    const m = mount(
      fake({ record: vi.fn(() => new Promise<RecordResult>((resolve) => (finish = resolve))) }),
    );
    await settle();
    record();
    m.view.unmount();
    await act(async () => finish({ status: "recorded" }));
    expect(error).not.toHaveBeenCalled();
    expect(m.onSaved).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("needs a provider", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(createElement(Probe))).toThrow("PaymentProvider");
    error.mockRestore();
  });
});
