import { describe, expect, it, vi } from "vitest";
import { createDetailService, MEMBER_MISSING_MESSAGE, PAGE_SIZE } from "./service";

function svc(...outcomes: unknown[]) {
  const execute = vi.fn();
  for (const outcome of outcomes) execute.mockResolvedValueOnce(outcome);
  return { service: createDetailService({ client: { execute } as never }), execute };
}

const sent = (execute: ReturnType<typeof vi.fn>, call = 0) =>
  JSON.stringify(execute.mock.calls[call]);

const network = { status: "network", message: "Offline" };
const error = { status: "error", error: { code: "OTHER", message: "Nope" } };
const forbidden = { status: "error", error: { code: "FORBIDDEN", message: "x" } };
const empty = { status: "empty" };

describe("header", () => {
  const member = {
    memberNo: "0042",
    name: null,
    status: "ACTIVE",
    standing: "OVERDUE",
    paidThrough: null,
    balanceDue: 7000,
    credit: 500,
    plan: { name: "Monthly" },
  };

  it("maps the member and the gym's currency and time zone", async () => {
    const s = svc({
      status: "data",
      data: { member, tenant: { currency: "USD", timezone: "UTC" } },
    });
    expect(await s.service.header("m1")).toEqual({
      status: "data",
      header: {
        memberId: "m1",
        memberNo: "0042",
        name: null,
        planName: "Monthly",
        status: "ACTIVE",
        standing: "OVERDUE",
        paidThrough: null,
        balanceDue: 7000,
        credit: 500,
        currency: "USD",
        timezone: "UTC",
      },
    });
    expect(sent(s.execute)).toContain('"m1"');
  });

  it("maps every failure", async () => {
    const cases: [unknown, string][] = [
      [network, "Offline"],
      [error, "Nope"],
      [empty, MEMBER_MISSING_MESSAGE],
      [{ status: "data", data: { member: null, tenant: {} } }, MEMBER_MISSING_MESSAGE],
    ];
    for (const [outcome, message] of cases) {
      expect(await svc(outcome).service.header("m1")).toEqual({ status: "failed", message });
    }
  });
});

describe("tab pages", () => {
  it("maps invoices and sends the cursor and page size", async () => {
    const s = svc({
      status: "data",
      data: {
        invoices: {
          items: [
            {
              id: "i1",
              periodStart: "2026-11-01",
              periodEnd: "2026-11-30",
              dueDate: "2026-11-01",
              total: 3000,
              amountDue: 3000,
              isPaid: false,
              isVoid: false,
              voidReason: null,
            },
          ],
          nextCursor: "c2",
        },
      },
    });
    const page = await s.service.invoices("m1")("c1");
    expect(page).toMatchObject({ status: "page", nextCursor: "c2" });
    expect(sent(s.execute)).toContain('"c1"');
    expect(sent(s.execute)).toContain(String(PAGE_SIZE));
  });

  it("maps payments, visits, discounts and history, with null for what is missing", async () => {
    const payments = svc({
      status: "data",
      data: {
        payments: {
          items: [{ id: "p1", amount: 100, method: "CASH", paidOn: "2026-11-01", isVoid: false }],
          nextCursor: null,
        },
      },
    });
    expect(await payments.service.payments("m1")()).toEqual({
      status: "page",
      items: [
        {
          id: "p1",
          amount: 100,
          method: "CASH",
          paidOn: "2026-11-01",
          isVoid: false,
          voidReason: null,
        },
      ],
      nextCursor: null,
    });
    const visits = svc({
      status: "data",
      data: { visits: { items: [{ id: "v1" }], nextCursor: "n" } },
    });
    expect(await visits.service.visits("m1")()).toEqual({
      status: "page",
      items: [{ id: "v1" }],
      nextCursor: "n",
    });
    const discounts = svc({ status: "data", data: { discounts: [{ id: "d1" }] } });
    expect(await discounts.service.discounts("m1")()).toEqual({
      status: "page",
      items: [{ id: "d1", reason: null, endsOn: null }],
      nextCursor: null,
    });
    const history = svc({ status: "data", data: { membershipPeriods: [{ id: "h1" }] } });
    expect(await history.service.history("m1")()).toEqual({
      status: "page",
      items: [{ id: "h1", validTo: null, reason: null }],
      nextCursor: null,
    });
  });

  it("maps failures and an empty answer", async () => {
    expect(await svc(network).service.visits("m1")()).toEqual({
      status: "failed",
      message: "Offline",
    });
    expect(await svc(error).service.visits("m1")()).toEqual({ status: "failed", message: "Nope" });
    expect(await svc(empty).service.visits("m1")()).toEqual({
      status: "page",
      items: [],
      nextCursor: null,
    });
  });
});

describe("actions", () => {
  const done = (field: string) => ({ status: "data", data: { [field]: { errors: [] } } });
  const refused = (field: string, code: string, message = "m") => ({
    status: "data",
    data: { [field]: { errors: [{ code, message }] } },
  });

  it("sends the status and the reason for pause, resume and cancel", async () => {
    const s = svc(done("updateMember"));
    expect(await s.service.changeStatus("m1", "PAUSED", "Away")).toEqual({ status: "done" });
    expect(sent(s.execute)).toContain('"PAUSED"');
    expect(sent(s.execute)).toContain('"Away"');
  });

  it("sends the id and the reason when voiding", async () => {
    const payment = svc(done("voidPayment"));
    expect(await payment.service.voidPayment("p1", "Wrong")).toEqual({ status: "done" });
    expect(sent(payment.execute)).toContain('"p1"');
    const invoice = svc(done("voidInvoice"));
    expect(await invoice.service.voidInvoice("i1", "Wrong")).toEqual({ status: "done" });
    expect(sent(invoice.execute)).toContain('"i1"');
  });

  it("separates forbidden, invalid, refused and failed", async () => {
    const change = (outcome: unknown) => svc(outcome).service.voidPayment("p1", "r");
    expect(await change(forbidden)).toEqual({ status: "forbidden" });
    expect(await change(refused("voidPayment", "FORBIDDEN"))).toEqual({ status: "forbidden" });
    expect(await change(refused("voidPayment", "INVALID_INPUT", "Need a reason"))).toEqual({
      status: "invalid",
      message: "Need a reason",
    });
    for (const code of ["CONFLICT", "ALREADY_VOID", "HAS_ALLOCATIONS"]) {
      expect(await change(refused("voidPayment", code, "Taken"))).toEqual({
        status: "refused",
        message: "Taken",
      });
    }
    expect(await change(refused("voidPayment", "NOT_FOUND", "Gone"))).toEqual({
      status: "failed",
      message: "Gone",
    });
    expect(await change(network)).toEqual({ status: "failed", message: "Offline" });
    expect(await change(error)).toEqual({ status: "failed", message: "Nope" });
    expect(await change(empty)).toMatchObject({ status: "failed" });
  });
});
