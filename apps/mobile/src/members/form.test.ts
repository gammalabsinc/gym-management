import { describe, expect, it } from "vitest";
import {
  EMPTY_FORM,
  editChanged,
  fieldOf,
  invoicePreview,
  isCalendarDate,
  NAME_MAX,
  newChanged,
  placeProblems,
  todayIn,
  validateEdit,
  validateNew,
} from "./form";

const good = {
  ...EMPTY_FORM,
  name: "  Sam Lee ",
  email: " Sam@Example.COM ",
  phone: "",
  joinedOn: "2026-12-13",
};

describe("todayIn", () => {
  it("uses the date in the gym's time zone, not the device's", () => {
    const instant = new Date("2026-12-14T03:30:00Z");
    expect(todayIn("America/Toronto", instant)).toBe("2026-12-13");
    expect(todayIn("Asia/Karachi", instant)).toBe("2026-12-14");
  });
});

describe("isCalendarDate", () => {
  it("accepts real dates and rejects the rest", () => {
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("13/12/2026")).toBe(false);
    expect(isCalendarDate("")).toBe(false);
  });
});

describe("validateNew", () => {
  it("trims, lowercases the email and sends integers and ids only", () => {
    const result = validateNew(
      { ...good, referrer: { id: "r1", name: "Ana", email: "a@x.com" } },
      "p1",
    );
    expect(result).toEqual({
      ok: true,
      value: {
        name: "Sam Lee",
        email: "sam@example.com",
        phone: null,
        planId: "p1",
        joinedOn: "2026-12-13",
        referredById: "r1",
      },
    });
  });

  it("keeps a typed phone and sends no referrer when there is none", () => {
    const result = validateNew({ ...good, phone: " +1 (416) 555-0100 " }, "p1");
    expect(result).toMatchObject({
      ok: true,
      value: { phone: "+1 (416) 555-0100", referredById: null },
    });
  });

  it("names every field that is wrong", () => {
    const result = validateNew(
      { ...EMPTY_FORM, name: "", email: "nope", phone: "abc", joinedOn: "2026-02-30" },
      "p1",
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        name: "Enter the member's full name.",
        email: "Enter the member's Google email.",
        phone: "Enter a phone number, like 416 555 0100.",
        joinedOn: "Enter a date like 2026-12-13.",
      },
    });
  });

  it("rejects a name that is too long", () => {
    const result = validateNew({ ...good, name: "x".repeat(NAME_MAX + 1) }, "p1");
    expect(result).toEqual({
      ok: false,
      errors: { name: `Use ${NAME_MAX} characters or fewer.` },
    });
  });
});

describe("validateEdit", () => {
  it("sends the trimmed name and a null phone when it is cleared", () => {
    expect(validateEdit({ ...good, phone: "  " })).toEqual({
      ok: true,
      value: { name: "Sam Lee", phone: null },
    });
  });

  it("rejects a blank name and a bad phone", () => {
    expect(validateEdit({ ...good, name: " ", phone: "12" })).toEqual({
      ok: false,
      errors: {
        name: "Enter the member's full name.",
        phone: "Enter a phone number, like 416 555 0100.",
      },
    });
  });
});

describe("changed", () => {
  it("compares trimmed text for edit and every field for add", () => {
    expect(editChanged(good, { ...good, name: "Sam Lee", phone: "" })).toBe(false);
    expect(editChanged(good, { ...good, phone: "5550100" })).toBe(true);
    expect(newChanged(good, good)).toBe(false);
    expect(newChanged(good, { ...good, email: "other@x.com" })).toBe(true);
    expect(newChanged(good, { ...good, joinedOn: "2026-12-14" })).toBe(true);
    expect(newChanged(good, { ...good, referrer: { id: "r", name: null, email: "r@x.com" } })).toBe(
      true,
    );
  });
});

describe("invoicePreview", () => {
  const fees = { admissionFee: 5000, monthlyFee: 8000 };

  it("adds the admission and monthly lines, due on the join date", () => {
    expect(invoicePreview(fees, " 2026-12-13 ")).toEqual({
      admission: 5000,
      monthly: 8000,
      total: 13000,
      dueOn: "2026-12-13",
    });
  });

  it("shows nothing until the date is real", () => {
    expect(invoicePreview(fees, "2026-1")).toBeNull();
  });
});

describe("server problems", () => {
  it("finds the field from the last part of its name", () => {
    expect(fieldOf("input.email")).toBe("email");
    expect(fieldOf("phone")).toBe("phone");
    expect(fieldOf("input.planId")).toBeNull();
    expect(fieldOf(null)).toBeNull();
  });

  it("puts a duplicate email on the email field and the rest above Save", () => {
    const placed = placeProblems([
      { field: null, code: "CONFLICT", message: "This person is already a member here" },
      { field: "input.name", code: "INVALID_INPUT", message: "Too long" },
      { field: null, code: "NOT_FOUND", message: "Plan not found" },
    ]);
    expect(placed.errors).toEqual({
      email: "This person is already a member here",
      name: "Too long",
    });
    expect(placed.general).toBe("Plan not found");
  });
});
