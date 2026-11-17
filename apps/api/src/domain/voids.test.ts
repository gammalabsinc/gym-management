import { describe, expect, it } from "vitest";
import { MAX_REASON_LENGTH } from "./membership";
import { parseVoidInvoice, parseVoidPayment, reallocateCredit } from "./voids";

const ID = "11111111-1111-4111-8111-111111111111";

describe("parseVoidPayment and parseVoidInvoice", () => {
  it("trim the reason and lower case the id", () => {
    expect(parseVoidPayment({ paymentId: ID.toUpperCase(), reason: "  wrong member " })).toEqual({
      ok: true,
      value: { id: ID, reason: "wrong member" },
    });
    expect(parseVoidInvoice({ invoiceId: ID, reason: "duplicate" })).toEqual({
      ok: true,
      value: { id: ID, reason: "duplicate" },
    });
  });

  it("require a reason of a sensible length", () => {
    for (const reason of ["", "   ", "x".repeat(MAX_REASON_LENGTH + 1)]) {
      const parsed = parseVoidPayment({ paymentId: ID, reason });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error.message).toBe("Invalid void");
    }
    expect(parseVoidInvoice({ invoiceId: ID, reason: "x".repeat(MAX_REASON_LENGTH) }).ok).toBe(
      true,
    );
  });

  it("report a bad id together with a bad reason, naming the field of each kind", () => {
    const payment = parseVoidPayment({ paymentId: "nope", reason: "" });
    expect(!payment.ok && payment.error.issues.map((i) => i.path[0])).toEqual([
      "paymentId",
      "reason",
    ]);
    const invoice = parseVoidInvoice({ invoiceId: "nope", reason: "ok" });
    expect(!invoice.ok && invoice.error.issues.map((i) => i.path[0])).toEqual(["invoiceId"]);
  });
});

describe("reallocateCredit", () => {
  const unpaid = [
    { invoiceId: "a", amountDue: 5000 },
    { invoiceId: "b", amountDue: 5000 },
  ];

  it("settles the oldest invoice first from the oldest payment", () => {
    expect(
      reallocateCredit(
        [
          { paymentId: "p1", remainder: 3000 },
          { paymentId: "p2", remainder: 4000 },
        ],
        unpaid,
      ),
    ).toEqual([
      { paymentId: "p1", invoiceId: "a", amount: 3000 },
      { paymentId: "p2", invoiceId: "a", amount: 2000 },
      { paymentId: "p2", invoiceId: "b", amount: 2000 },
    ]);
  });

  it("never gives an invoice more than it is owed, and leaves surplus credit unused", () => {
    expect(
      reallocateCredit([{ paymentId: "p1", remainder: 99999 }], unpaid).map((a) => a.amount),
    ).toEqual([5000, 5000]);
  });

  it("places nothing when there is no credit or nothing is open", () => {
    expect(reallocateCredit([], unpaid)).toEqual([]);
    expect(reallocateCredit([{ paymentId: "p1", remainder: 100 }], [])).toEqual([]);
  });
});
