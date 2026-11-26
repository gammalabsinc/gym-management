import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MembersProvider } from "../members/context";
import type { MembersService } from "../members/service";
import { Customers } from "./Customers";
import { CustomersProvider } from "./context";
import type { CustomersService } from "./list";
import { PaymentProvider } from "./payment/context";
import type { PaymentService } from "./payment/service";

vi.mock("./detail/CustomerDetail", () => ({
  CustomerDetail: (props: {
    readonly id: string;
    readonly onBack: () => void;
    readonly onEdit: () => void;
    readonly onRecordPayment: () => void;
  }) =>
    createElement(
      "div",
      null,
      createElement("span", null, `Detail ${props.id}`),
      createElement("button", { type: "button", onClick: props.onEdit }, "Edit this member"),
      createElement("button", { type: "button", onClick: props.onRecordPayment }, "Pay"),
    ),
}));

afterEach(cleanup);

const customers: CustomersService = {
  fetch: async () => ({
    status: "page",
    items: [
      {
        id: "m1",
        name: "Sam Lee",
        status: "ACTIVE",
        standing: "PAID",
        paidThrough: "2026-12-13",
        balanceDue: 0,
        visitsThisMonth: 1,
        visitsLastMonth: 2,
        totalPaid: 100,
        currency: "USD",
      },
    ],
    nextCursor: null,
  }),
};

const member = {
  id: "m1",
  memberNo: "M-001",
  name: "Sam Lee",
  email: "sam@x.com",
  phone: null,
  planName: "Standard",
  joinedOn: "2026-12-13",
  referredByName: null,
};

const payment: PaymentService = {
  newRequestId: () => "req-1",
  load: async () => ({
    status: "ready",
    setup: {
      memberName: "Sam Lee",
      balanceDue: 0,
      paidThrough: null,
      credit: 0,
      currency: "USD",
      timezone: "UTC",
    },
  }),
  preview: async () => ({
    status: "preview",
    preview: { invoicesCovered: 1, paidThroughAfter: null, creditAfter: 0 },
  }),
  record: async () => ({ status: "recorded" }),
};

function mount(update = vi.fn(async () => ({ status: "saved" as const, memberId: "m1" }))) {
  const members: MembersService = {
    loadFees: vi.fn(),
    loadMember: vi.fn(async () => ({ status: "loaded" as const, data: member })),
    searchReferrers: vi.fn(),
    create: vi.fn(),
    update,
  };
  render(
    createElement(
      CustomersProvider,
      { service: customers },
      createElement(
        MembersProvider,
        { service: members },
        createElement(
          PaymentProvider,
          { service: payment },
          createElement(Customers, { viewer: "owner" }),
        ),
      ),
    ),
  );
  return { members };
}

const settle = () => act(async () => {});

async function openDetail() {
  await settle();
  fireEvent.click(screen.getByLabelText("Open Sam Lee"));
  await settle();
}

describe("Customers routes", () => {
  it("edits a member from the detail and returns to the detail on save", async () => {
    const { members } = mount();
    await openDetail();
    fireEvent.click(screen.getByText("Edit this member"));
    await settle();
    expect(screen.getByText("M-001")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Samuel Lee" } });
    fireEvent.click(screen.getByLabelText("Save changes"));
    await settle();
    expect(members.update).toHaveBeenCalledWith("m1", { name: "Samuel Lee", phone: null });
    expect(screen.getByText("Detail m1")).toBeTruthy();
  });

  it("returns to the detail when the edit is cancelled", async () => {
    mount();
    await openDetail();
    fireEvent.click(screen.getByText("Edit this member"));
    await settle();
    fireEvent.click(screen.getByLabelText("Cancel"));
    expect(screen.getByText("Detail m1")).toBeTruthy();
  });

  it("opens the payment form and goes back to the detail when it is cancelled", async () => {
    mount();
    await openDetail();
    fireEvent.click(screen.getByText("Pay"));
    await settle();
    expect(screen.getByLabelText("Amount")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByText("Detail m1")).toBeTruthy();
  });

  it("goes back to the detail after a payment is recorded", async () => {
    mount();
    await openDetail();
    fireEvent.click(screen.getByText("Pay"));
    await settle();
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "10" } });
    fireEvent.click(screen.getByText("Record payment", { selector: "button span" }));
    await settle();
    expect(screen.getByText("Detail m1")).toBeTruthy();
  });
});
