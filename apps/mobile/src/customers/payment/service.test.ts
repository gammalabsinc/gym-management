import { describe, expect, it, vi } from "vitest";
import {
  createPaymentService,
  MEMBER_MISSING_MESSAGE,
  PREVIEW_FAILED_MESSAGE,
  RECORD_FAILED_MESSAGE,
} from "./service";

function svc(...outcomes: unknown[]) {
  const execute = vi.fn();
  for (const outcome of outcomes) execute.mockResolvedValueOnce(outcome);
  const service = createPaymentService({
    client: { execute } as never,
    newRequestId: () => "req-1",
  });
  return { service, execute };
}

const sent = (execute: ReturnType<typeof vi.fn>) => JSON.stringify(execute.mock.calls[0]);
const network = { status: "network", message: "Offline" };
const error = { status: "error", error: { code: "OTHER", message: "Nope" } };
const forbidden = { status: "error", error: { code: "FORBIDDEN", message: "x" } };
const empty = { status: "empty" };

describe("newRequestId", () => {
  it("makes a new id each time it is asked", () => {
    let count = 0;
    const service = createPaymentService({
      client: { execute: vi.fn() } as never,
      newRequestId: () => `r${++count}`,
    });
    expect([service.newRequestId(), service.newRequestId()]).toEqual(["r1", "r2"]);
  });
});

describe("load", () => {
  it("maps what the form needs", async () => {
    const s = svc({
      status: "data",
      data: {
        member: { name: null, balanceDue: 7000, paidThrough: null, credit: 0 },
        tenant: { currency: "USD", timezone: "UTC" },
      },
    });
    expect(await s.service.load("m1")).toEqual({
      status: "ready",
      setup: {
        memberName: null,
        balanceDue: 7000,
        paidThrough: null,
        credit: 0,
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
      expect(await svc(outcome).service.load("m1")).toEqual({ status: "failed", message });
    }
  });
});

describe("preview", () => {
  it("passes the server's answer on and only counts the invoices it names", async () => {
    const s = svc({
      status: "data",
      data: {
        previewPayment: {
          allocations: [{ invoiceId: "i1" }, { invoiceId: "i2" }],
          paidThroughAfter: "2026-12-31",
          creditAfter: 250,
        },
      },
    });
    expect(await s.service.preview("m1", 6000)).toEqual({
      status: "preview",
      preview: { invoicesCovered: 2, paidThroughAfter: "2026-12-31", creditAfter: 250 },
    });
    expect(sent(s.execute)).toContain("6000");
  });

  it("keeps a missing paid through date as null", async () => {
    const s = svc({
      status: "data",
      data: { previewPayment: { allocations: [], paidThroughAfter: null, creditAfter: 0 } },
    });
    expect(await s.service.preview("m1", 1)).toMatchObject({
      preview: { paidThroughAfter: null, invoicesCovered: 0 },
    });
  });

  it("maps every failure", async () => {
    const cases: [unknown, string][] = [
      [network, "Offline"],
      [error, "Nope"],
      [empty, PREVIEW_FAILED_MESSAGE],
    ];
    for (const [outcome, message] of cases) {
      expect(await svc(outcome).service.preview("m1", 1)).toEqual({ status: "failed", message });
    }
  });
});

describe("record", () => {
  const payment = {
    clientRequestId: "req-1",
    memberId: "m1",
    amount: 3000,
    method: "CASH" as const,
    paidOn: "2026-11-25",
    proofLink: null,
  };
  const recorded = {
    status: "data",
    data: { recordPayment: { payment: { id: "p1" }, errors: [] } },
  };
  const refused = (...errors: unknown[]) => ({
    status: "data",
    data: { recordPayment: { payment: null, errors } },
  });

  it("sends the request id and leaves a missing proof link out", async () => {
    const s = svc(recorded);
    expect(await s.service.record(payment)).toEqual({ status: "recorded" });
    expect(sent(s.execute)).toContain('"req-1"');
    expect(sent(s.execute)).not.toContain("proofLink");
    const withProof = svc(recorded);
    await withProof.service.record({ ...payment, proofLink: "https://x.test/p" });
    expect(sent(withProof.execute)).toContain("https://x.test/p");
  });

  it("puts each field error on its field and keeps one general message", async () => {
    const result = await svc(
      refused(
        { code: "INVALID_INPUT", field: "amount", message: "Too small" },
        { code: "INVALID_INPUT", field: "paidOn", message: "Future" },
        { code: "INVALID_INPUT", field: "proofLink", message: "Bad link" },
        { code: "NOT_FOUND", field: null, message: "Member is gone" },
        { code: "NOT_FOUND", field: null, message: "Second" },
      ),
    ).service.record(payment);
    expect(result).toEqual({
      status: "invalid",
      fields: { amount: "Too small", paidOn: "Future", proofLink: "Bad link" },
      message: "Member is gone",
    });
  });

  it("maps forbidden, failures and an answer with no payment", async () => {
    expect(await svc(forbidden).service.record(payment)).toEqual({ status: "forbidden" });
    expect(
      await svc(refused({ code: "FORBIDDEN", field: null, message: "x" })).service.record(payment),
    ).toEqual({ status: "forbidden" });
    expect(await svc(network).service.record(payment)).toEqual({
      status: "failed",
      message: "Offline",
    });
    expect(await svc(error).service.record(payment)).toEqual({ status: "failed", message: "Nope" });
    for (const outcome of [empty, refused()]) {
      expect(await svc(outcome).service.record(payment)).toEqual({
        status: "failed",
        message: RECORD_FAILED_MESSAGE,
      });
    }
  });
});
