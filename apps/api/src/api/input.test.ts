import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  boundedText,
  dateSchema,
  emailSchema,
  guarded,
  idSchema,
  LIMITS,
  minorUnitsSchema,
  optional,
  parseInput,
  phoneSchema,
  positiveMinorUnitsSchema,
  urlSchema,
} from "./input";

const accepts = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;

describe("boundedText", () => {
  it("trims, then enforces the limit", () => {
    const schema = boundedText(5);
    expect(schema.parse("  abc  ")).toBe("abc");
    expect(accepts(schema, "abcdef")).toBe(false);
    expect(accepts(schema, "   ")).toBe(false);
    expect(accepts(schema, "")).toBe(false);
  });

  it("is not fooled by padding that pushes a short value past the limit", () => {
    expect(accepts(boundedText(5), `   ${"a".repeat(5)}   `)).toBe(true);
  });
});

describe("idSchema", () => {
  it("accepts uuids and simple ids", () => {
    expect(accepts(idSchema, "3f2b8c1e-0a4d-4f6e-9b1c-7d5e2a9f0c11")).toBe(true);
    expect(accepts(idSchema, "req_123:retry-1")).toBe(true);
  });

  it("rejects empty, oversized and unsafe ids", () => {
    expect(accepts(idSchema, "")).toBe(false);
    expect(accepts(idSchema, "a".repeat(LIMITS.id + 1))).toBe(false);
    expect(accepts(idSchema, "a b")).toBe(false);
    expect(accepts(idSchema, "x'; DROP TABLE members;--")).toBe(false);
  });
});

describe("emailSchema", () => {
  it("trims and lower cases, so the same address always matches", () => {
    expect(emailSchema.parse("  Sam@Example.COM ")).toBe("sam@example.com");
  });

  it("rejects text that is not an email and oversized addresses", () => {
    expect(accepts(emailSchema, "not an email")).toBe(false);
    expect(accepts(emailSchema, `${"a".repeat(LIMITS.email)}@example.com`)).toBe(false);
  });
});

describe("phoneSchema", () => {
  it("accepts common phone formats", () => {
    expect(accepts(phoneSchema, "+1 (416) 555-0100")).toBe(true);
  });

  it("rejects letters, short and oversized values", () => {
    expect(accepts(phoneSchema, "call me")).toBe(false);
    expect(accepts(phoneSchema, "12")).toBe(false);
    expect(accepts(phoneSchema, "1".repeat(LIMITS.phone + 1))).toBe(false);
  });
});

describe("dateSchema", () => {
  it("accepts a real date and rejects malformed or impossible ones", () => {
    expect(accepts(dateSchema, "2026-11-14")).toBe(true);
    for (const bad of ["2026-02-30", "14/11/2026", "2026-11-14T10:00:00Z", "", "tomorrow"]) {
      expect(accepts(dateSchema, bad)).toBe(false);
    }
    expect(accepts(dateSchema, 20261114)).toBe(false);
  });
});

describe("urlSchema", () => {
  it("accepts http and https links only, within the limit", () => {
    expect(accepts(urlSchema, "https://example.com/proof.pdf")).toBe(true);
    expect(accepts(urlSchema, "javascript:alert(1)")).toBe(false);
    expect(accepts(urlSchema, "ftp://example.com/file")).toBe(false);
    expect(accepts(urlSchema, `https://example.com/${"a".repeat(LIMITS.url)}`)).toBe(false);
  });
});

describe("money", () => {
  it("minorUnitsSchema allows zero and rejects negatives, fractions and overflow", () => {
    expect(accepts(minorUnitsSchema, 0)).toBe(true);
    expect(accepts(minorUnitsSchema, 12_500)).toBe(true);
    expect(accepts(minorUnitsSchema, -1)).toBe(false);
    expect(accepts(minorUnitsSchema, 10.5)).toBe(false);
    expect(accepts(minorUnitsSchema, LIMITS.maxInt + 1)).toBe(false);
    expect(accepts(minorUnitsSchema, "100")).toBe(false);
    expect(accepts(minorUnitsSchema, Number.NaN)).toBe(false);
  });

  it("positiveMinorUnitsSchema also rejects zero", () => {
    expect(accepts(positiveMinorUnitsSchema, 1)).toBe(true);
    expect(accepts(positiveMinorUnitsSchema, 0)).toBe(false);
    expect(accepts(positiveMinorUnitsSchema, -500)).toBe(false);
  });
});

describe("optional", () => {
  it("treats null and a missing value the same way", () => {
    const schema = z.object({ note: optional(boundedText(10)) });
    expect(schema.parse({ note: null })).toEqual({ note: undefined });
    expect(schema.parse({})).toEqual({ note: undefined });
    expect(schema.parse({ note: " hi " })).toEqual({ note: "hi" });
    expect(accepts(schema, { note: "x".repeat(11) })).toBe(false);
  });
});

describe("parseInput", () => {
  const schema = z.object({ name: boundedText(5), age: z.number().int().min(0) });

  it("returns the parsed value", () => {
    expect(parseInput(schema, { name: " Sam ", age: 4 })).toEqual({
      ok: true,
      value: { name: "Sam", age: 4 },
    });
  });

  it("returns a validation error naming each bad field, and never throws", () => {
    const result = parseInput(schema, { name: "toolongname", age: -1 });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "validation", message: "Invalid input" },
    });
    if (result.ok) throw new Error("expected a failure");
    expect(result.error.issues.map((issue) => issue.path)).toEqual([["name"], ["age"]]);
    expect(parseInput(schema, null).ok).toBe(false);
    expect(parseInput(schema, undefined).ok).toBe(false);
  });
});

describe("guarded", () => {
  const schema = z.object({ amount: positiveMinorUnitsSchema });

  it("runs the use case with the parsed input", async () => {
    const useCase = vi.fn(async (input: { amount: number }) => input.amount * 2);
    expect(await guarded(schema, useCase)({ amount: 21 })).toBe(42);
    expect(useCase).toHaveBeenCalledWith({ amount: 21 });
  });

  it("never runs the use case when the input is invalid", async () => {
    const useCase = vi.fn(() => "ran");
    const result = await guarded(schema, useCase)({ amount: -5 });
    expect(useCase).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, error: { kind: "validation" } });
  });

  it("accepts a synchronous use case", async () => {
    expect(await guarded(schema, (input) => input.amount)({ amount: 3 })).toBe(3);
  });
});
