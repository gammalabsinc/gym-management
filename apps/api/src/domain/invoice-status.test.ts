import { describe, expect, it } from "vitest";
import { invoiceStatusOf, isOwing } from "./invoice-status";
import { type InvoiceDue, standingOf } from "./standing";

const TODAY = "2026-11-17";

function invoice(overrides: Partial<InvoiceDue> = {}): InvoiceDue {
  return { dueDate: "2026-11-01", amountDue: 5000, isVoid: false, ...overrides };
}

describe("invoiceStatusOf", () => {
  it.each([
    ["owing and past due", invoice(), "unpaid"],
    ["owing and due today", invoice({ dueDate: TODAY }), "unpaid"],
    ["owing and due tomorrow", invoice({ dueDate: "2026-11-18" }), "upcoming"],
    ["part paid and past due", invoice({ amountDue: 1 }), "unpaid"],
    ["fully paid and past due", invoice({ amountDue: 0 }), "paid"],
    ["fully paid and not yet due", invoice({ dueDate: "2026-12-01", amountDue: 0 }), "paid"],
    ["void with an amount left", invoice({ isVoid: true }), "voided"],
    ["void and settled", invoice({ isVoid: true, amountDue: 0 }), "voided"],
  ] as const)("%s is %s", (_name, input, expected) => {
    expect(invoiceStatusOf(input, TODAY)).toBe(expected);
  });
});

describe("isOwing", () => {
  it("is false for a void or settled invoice and true for a live one with money left", () => {
    expect(isOwing(invoice())).toBe(true);
    expect(isOwing(invoice({ amountDue: 0 }))).toBe(false);
    expect(isOwing(invoice({ isVoid: true }))).toBe(false);
  });

  it("is the rule standing uses, so an owing invoice drives standing and a settled one does not", () => {
    const base = { today: TODAY, membershipStatus: "active", warnDaysBefore: 3, redDaysAfter: 7 };
    const owing = invoice({ dueDate: "2026-10-01" });
    const settled = invoice({ dueDate: "2026-10-01", amountDue: 0 });
    expect(standingOf({ ...base, membershipStatus: "active", invoices: [owing] })).toEqual({
      ok: true,
      value: "overdue",
    });
    expect(standingOf({ ...base, membershipStatus: "active", invoices: [settled] })).toEqual({
      ok: true,
      value: "paid",
    });
  });
});
