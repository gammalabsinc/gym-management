import { describe, expect, it } from "vitest";
import { type InvoiceDue, type Standing, type StandingInput, standingOf } from "./standing";

function invoice(dueDate: string, overrides: Partial<InvoiceDue> = {}): InvoiceDue {
  return { dueDate, amountDue: 5000, isVoid: false, ...overrides };
}

function input(overrides: Partial<StandingInput> = {}): StandingInput {
  return {
    today: "2026-03-10",
    membershipStatus: "active",
    warnDaysBefore: 5,
    redDaysAfter: 5,
    invoices: [],
    ...overrides,
  };
}

function standing(overrides: Partial<StandingInput> = {}): Standing {
  const result = standingOf(input(overrides));
  if (!result.ok) throw new Error(`unexpected failure: ${result.error.message}`);
  return result.value;
}

describe("standingOf", () => {
  it("is paid with no invoices", () => {
    expect(standing()).toBe("paid");
  });

  it("is paid when every invoice is fully paid", () => {
    expect(standing({ invoices: [invoice("2026-01-01", { amountDue: 0 })] })).toBe("paid");
  });

  it("ignores voided invoices even when they show an amount due", () => {
    expect(standing({ invoices: [invoice("2026-01-01", { isVoid: true })] })).toBe("paid");
  });

  it("is paid while the due date is more than warnDaysBefore days away", () => {
    expect(standing({ invoices: [invoice("2026-03-16")] })).toBe("paid");
    expect(standing({ invoices: [invoice("2026-04-10")] })).toBe("paid");
  });

  it("is due_soon from warnDaysBefore days before the due date up to red days after it", () => {
    expect(standing({ invoices: [invoice("2026-03-15")] })).toBe("due_soon");
    expect(standing({ invoices: [invoice("2026-03-10")] })).toBe("due_soon");
    expect(standing({ invoices: [invoice("2026-03-05")] })).toBe("due_soon");
  });

  it("is overdue once more than redDaysAfter days past the due date", () => {
    expect(standing({ invoices: [invoice("2026-03-04")] })).toBe("overdue");
    expect(standing({ invoices: [invoice("2025-12-01")] })).toBe("overdue");
  });

  it("reads the thresholds from the settings", () => {
    const due = [invoice("2026-03-14")];
    expect(standing({ invoices: due, warnDaysBefore: 3 })).toBe("paid");
    expect(standing({ invoices: due, warnDaysBefore: 4 })).toBe("due_soon");
    const late = [invoice("2026-03-08")];
    expect(standing({ invoices: late, redDaysAfter: 2 })).toBe("due_soon");
    expect(standing({ invoices: late, redDaysAfter: 1 })).toBe("overdue");
  });

  it("works with zero day thresholds", () => {
    const zero = { warnDaysBefore: 0, redDaysAfter: 0 };
    expect(standing({ ...zero, invoices: [invoice("2026-03-11")] })).toBe("paid");
    expect(standing({ ...zero, invoices: [invoice("2026-03-10")] })).toBe("due_soon");
    expect(standing({ ...zero, invoices: [invoice("2026-03-09")] })).toBe("overdue");
  });

  it("is decided by the oldest unpaid invoice, so a skipped month is not hidden by a later one", () => {
    const invoices = [
      invoice("2026-03-04"),
      invoice("2026-02-04", { amountDue: 0 }),
      invoice("2026-04-04"),
    ];
    expect(standing({ invoices })).toBe("overdue");
    expect(standing({ invoices: [...invoices].reverse() })).toBe("overdue");
  });

  it("looks past a paid or voided older invoice to the oldest one still unpaid", () => {
    const invoices = [
      invoice("2026-01-04", { isVoid: true }),
      invoice("2026-02-04", { amountDue: 0 }),
      invoice("2026-03-12"),
    ];
    expect(standing({ invoices })).toBe("due_soon");
  });

  it("is inactive for a paused or cancelled member, whatever the invoices say", () => {
    for (const membershipStatus of ["paused", "cancelled"] as const) {
      expect(standing({ membershipStatus })).toBe("inactive");
      expect(standing({ membershipStatus, invoices: [invoice("2025-01-01")] })).toBe("inactive");
      expect(standing({ membershipStatus, invoices: [invoice("2026-03-12")] })).toBe("inactive");
    }
  });
});

describe("standingOf validation", () => {
  function issuePaths(overrides: Partial<StandingInput>): unknown[] {
    const result = standingOf(input(overrides));
    if (result.ok) throw new Error("expected a validation error");
    expect(result.error.kind).toBe("validation");
    return result.error.issues.map((entry) => entry.path);
  }

  it("rejects a bad today", () => {
    expect(issuePaths({ today: "2026-02-30" })).toEqual([["today"]]);
  });

  it("rejects thresholds that are negative, fractional or absurdly large", () => {
    for (const value of [-1, 1.5, 367, Number.NaN]) {
      expect(issuePaths({ warnDaysBefore: value })).toEqual([["warnDaysBefore"]]);
      expect(issuePaths({ redDaysAfter: value })).toEqual([["redDaysAfter"]]);
    }
  });

  it("rejects bad invoice fields and reports every problem", () => {
    expect(
      issuePaths({
        today: "bad",
        invoices: [invoice("2026-03-01"), invoice("nope", { amountDue: -1 })],
      }),
    ).toEqual([["today"], ["invoices", 1, "dueDate"], ["invoices", 1, "amountDue"]]);
    expect(issuePaths({ invoices: [invoice("2026-03-01", { amountDue: 1.5 })] })).toEqual([
      ["invoices", 0, "amountDue"],
    ]);
  });

  it("validates even for an inactive member, so bad data is never hidden", () => {
    expect(issuePaths({ membershipStatus: "cancelled", today: "bad" })).toEqual([["today"]]);
  });
});
