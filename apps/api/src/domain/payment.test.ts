import { describe, expect, it } from "vitest";
import {
  allocateOldestFirst,
  applyAllocations,
  type LedgerInvoice,
  MAX_PAYMENT_AMOUNT,
  MAX_PROOF_LINK_LENGTH,
  paidThroughOf,
  parsePreviewPayment,
  parseRecordPayment,
  type RecordPaymentInput,
  suggestedAmountOf,
  unpaidOf,
} from "./payment";

const TODAY = "2026-11-16";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";

const input = (extra: Partial<RecordPaymentInput> = {}): RecordPaymentInput => ({
  clientRequestId: REQUEST_ID,
  memberId: MEMBER_ID,
  amount: 5000,
  method: "cash",
  ...extra,
});

function paths(result: ReturnType<typeof parseRecordPayment>): string[] {
  return result.ok ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("parseRecordPayment", () => {
  it("accepts a payment and dates it today when no date is given", () => {
    expect(parseRecordPayment(input(), TODAY)).toEqual({
      ok: true,
      value: {
        clientRequestId: REQUEST_ID,
        memberId: MEMBER_ID,
        amount: 5000,
        method: "cash",
        paidOn: TODAY,
        proofLink: null,
      },
    });
  });

  it("keeps a date in the past, today, and a proof link, and trims and lower cases the ids", () => {
    const result = parseRecordPayment(
      input({
        clientRequestId: ` ${REQUEST_ID.toUpperCase()} `,
        method: " bank_transfer ",
        paidOn: " 2026-01-02 ",
        proofLink: " https://example.test/r ",
      }),
      TODAY,
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        clientRequestId: REQUEST_ID,
        method: "bank_transfer",
        paidOn: "2026-01-02",
        proofLink: "https://example.test/r",
      },
    });
    expect(parseRecordPayment(input({ paidOn: TODAY }), TODAY).ok).toBe(true);
  });

  it("treats an empty date or link as left out", () => {
    expect(parseRecordPayment(input({ paidOn: "", proofLink: "  " }), TODAY)).toMatchObject({
      ok: true,
      value: { paidOn: TODAY, proofLink: null },
    });
    expect(parseRecordPayment(input({ paidOn: null, proofLink: null }), TODAY).ok).toBe(true);
  });

  it("refuses an amount that is not a whole number of more than zero, up to the limit", () => {
    for (const amount of [0, -1, 12.5, Number.NaN, MAX_PAYMENT_AMOUNT + 1]) {
      expect(paths(parseRecordPayment(input({ amount }), TODAY)), String(amount)).toEqual([
        "amount",
      ]);
    }
    expect(parseRecordPayment(input({ amount: MAX_PAYMENT_AMOUNT }), TODAY).ok).toBe(true);
  });

  it("refuses a method outside the list", () => {
    expect(paths(parseRecordPayment(input({ method: "barter" }), TODAY))).toEqual(["method"]);
  });

  it("refuses a date that is not real or is in the future", () => {
    expect(paths(parseRecordPayment(input({ paidOn: "2026-02-30" }), TODAY))).toEqual(["paidOn"]);
    expect(paths(parseRecordPayment(input({ paidOn: "2026-11-17" }), TODAY))).toEqual(["paidOn"]);
  });

  it("refuses a proof link that is not a web link or is too long", () => {
    for (const proofLink of ["receipt", "ftp://example.test/x", "javascript:alert(1)"]) {
      expect(paths(parseRecordPayment(input({ proofLink }), TODAY)), proofLink).toEqual([
        "proofLink",
      ]);
    }
    const long = `https://example.test/${"a".repeat(MAX_PROOF_LINK_LENGTH)}`;
    expect(paths(parseRecordPayment(input({ proofLink: long }), TODAY))).toEqual(["proofLink"]);
  });

  it("reports every problem at once", () => {
    const result = parseRecordPayment(
      { clientRequestId: "x", memberId: "y", amount: 0, method: "z", paidOn: "no" },
      TODAY,
    );
    expect(paths(result)).toEqual(["clientRequestId", "memberId", "amount", "method", "paidOn"]);
    expect(!result.ok && result.error.kind).toBe("validation");
  });
});

describe("allocateOldestFirst", () => {
  const owed = (invoiceId: string, amountDue: number) => ({ invoiceId, amountDue });

  it("pays the invoices in the order given, each in full while the money lasts", () => {
    expect(allocateOldestFirst(9000, [owed("a", 4000), owed("b", 4000), owed("c", 4000)])).toEqual({
      allocations: [
        { invoiceId: "a", amount: 4000 },
        { invoiceId: "b", amount: 4000 },
        { invoiceId: "c", amount: 1000 },
      ],
      remainder: 0,
    });
  });

  it("pays one invoice in part when the money runs out inside it", () => {
    expect(allocateOldestFirst(1500, [owed("a", 4000)])).toEqual({
      allocations: [{ invoiceId: "a", amount: 1500 }],
      remainder: 0,
    });
  });

  it("leaves what the invoices cannot take as the remainder", () => {
    expect(allocateOldestFirst(9000, [owed("a", 4000)])).toEqual({
      allocations: [{ invoiceId: "a", amount: 4000 }],
      remainder: 5000,
    });
    expect(allocateOldestFirst(9000, [])).toEqual({ allocations: [], remainder: 9000 });
  });

  it("skips an invoice that is owed nothing and stops when the money is gone", () => {
    expect(allocateOldestFirst(4000, [owed("a", 0), owed("b", 4000), owed("c", 4000)])).toEqual({
      allocations: [{ invoiceId: "b", amount: 4000 }],
      remainder: 0,
    });
  });

  it("never allocates more than the payment or more than an invoice is owed", () => {
    for (let amount = 1; amount <= 12000; amount += 997) {
      const result = allocateOldestFirst(amount, [
        owed("a", 3000),
        owed("b", 5000),
        owed("c", 2500),
      ]);
      const allocated = result.allocations.reduce((sum, a) => sum + a.amount, 0);
      expect(allocated + result.remainder).toBe(amount);
      expect(result.allocations.every((a) => a.amount > 0)).toBe(true);
    }
  });
});

describe("parsePreviewPayment", () => {
  it("takes a member and an amount", () => {
    expect(parsePreviewPayment({ memberId: ` ${MEMBER_ID.toUpperCase()} `, amount: 7000 })).toEqual(
      {
        ok: true,
        value: { memberId: MEMBER_ID, amount: 7000 },
      },
    );
  });

  it("leaves the amount empty when none was given", () => {
    for (const amount of [undefined, null]) {
      expect(parsePreviewPayment({ memberId: MEMBER_ID, amount })).toEqual({
        ok: true,
        value: { memberId: MEMBER_ID, amount: null },
      });
    }
  });

  it("refuses an amount with decimals, which is more than two places of the currency", () => {
    for (const amount of [12.5, 0.001, 1999.999]) {
      const parsed = parsePreviewPayment({ memberId: MEMBER_ID, amount });
      expect(parsed.ok).toBe(false);
    }
  });

  it("refuses an amount of zero or less, or above the limit, like a payment does", () => {
    for (const amount of [0, -1, MAX_PAYMENT_AMOUNT + 1]) {
      expect(parsePreviewPayment({ memberId: MEMBER_ID, amount }).ok).toBe(false);
    }
    expect(parsePreviewPayment({ memberId: MEMBER_ID, amount: MAX_PAYMENT_AMOUNT }).ok).toBe(true);
  });

  it("refuses a bad member id and reports every problem", () => {
    const parsed = parsePreviewPayment({ memberId: "nope", amount: 0 });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok)
      expect(parsed.error.issues.map((i) => i.path[0])).toEqual(["memberId", "amount"]);
  });
});

const invoice = (id: string, start: string, end: string, due: number): LedgerInvoice => ({
  invoiceId: id,
  periodStart: start,
  periodEnd: end,
  dueDate: start,
  amountDue: due,
});

const OCT = invoice("oct", "2026-10-10", "2026-11-09", 0);
const NOV = invoice("nov", "2026-11-10", "2026-12-09", 5000);
const DEC = invoice("dec", "2026-12-10", "2027-01-09", 5000);

describe("the ledger helpers", () => {
  it("lists unpaid invoices oldest cycle first and skips paid ones", () => {
    expect(unpaidOf([DEC, OCT, NOV])).toEqual([
      { invoiceId: "nov", amountDue: 5000 },
      { invoiceId: "dec", amountDue: 5000 },
    ]);
  });

  it("breaks a tie between two cycles that start the same day by id", () => {
    const a = invoice("a", "2026-11-10", "2026-12-09", 100);
    const b = invoice("b", "2026-11-10", "2026-12-09", 100);
    expect(unpaidOf([b, a]).map((i) => i.invoiceId)).toEqual(["a", "b"]);
  });

  it("applies allocations to the invoices they name and never goes below zero", () => {
    const after = applyAllocations([NOV, DEC], [{ invoiceId: "nov", amount: 6000 }]);
    expect(after.map((i) => i.amountDue)).toEqual([0, 5000]);
    expect(applyAllocations([NOV], [{ invoiceId: "nov", amount: 2000 }])[0]?.amountDue).toBe(3000);
  });

  it("says paid through is the end of the last paid cycle before the oldest unpaid one", () => {
    expect(paidThroughOf([OCT, NOV, DEC])).toBe("2026-11-09");
  });

  it("does not count a paid cycle that comes after an unpaid one", () => {
    expect(paidThroughOf([OCT, NOV, { ...DEC, amountDue: 0 }])).toBe("2026-11-09");
    expect(paidThroughOf([NOV, { ...DEC, amountDue: 0 }])).toBeNull();
  });

  it("goes to the last cycle when everything is paid, and is null with no invoices or no payment", () => {
    expect(paidThroughOf([OCT, { ...NOV, amountDue: 0 }])).toBe("2026-12-09");
    expect(paidThroughOf([])).toBeNull();
    expect(paidThroughOf([NOV])).toBeNull();
  });

  it("suggests what is owed on invoices due by today", () => {
    expect(suggestedAmountOf([OCT, NOV, DEC], "2026-11-16")).toBe(5000);
    expect(suggestedAmountOf([{ ...OCT, amountDue: 700 }, NOV], "2026-11-16")).toBe(5700);
  });

  it("suggests the oldest open invoice when nothing is due yet", () => {
    expect(
      suggestedAmountOf(
        [OCT, { ...DEC, amountDue: 4200 }, invoice("jan", "2027-01-10", "2027-02-09", 5000)],
        "2026-11-16",
      ),
    ).toBe(4200);
  });

  it("suggests nothing when every invoice is paid", () => {
    expect(suggestedAmountOf([OCT], "2026-11-16")).toBeNull();
    expect(suggestedAmountOf([], "2026-11-16")).toBeNull();
  });
});
