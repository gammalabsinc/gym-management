import { describe, expect, it } from "vitest";
import {
  decodeLedgerCursor,
  discountStatusOf,
  encodeLedgerCursor,
  parseLedgerPage,
} from "./member-ledger";
import { MAX_PAGE_SIZE } from "./member-list";

const MEMBER = "11111111-1111-4111-8111-111111111111";
const ROW = "22222222-2222-4222-8222-222222222222";

describe("discountStatusOf", () => {
  const live = { isActive: true, endsOn: null, consumedInvoiceId: null };

  it.each([
    ["open and switched on", live, "active"],
    ["ending today", { ...live, endsOn: "2026-11-17" }, "active"],
    ["ending in the future", { ...live, endsOn: "2026-12-31" }, "active"],
    ["ended yesterday", { ...live, endsOn: "2026-11-16" }, "ended"],
    ["switched off", { ...live, isActive: false }, "ended"],
    ["spent on an invoice", { ...live, consumedInvoiceId: ROW }, "consumed"],
    [
      "spent and since switched off",
      { isActive: false, endsOn: null, consumedInvoiceId: ROW },
      "consumed",
    ],
  ] as const)("%s is %s", (_name, discount, expected) => {
    expect(discountStatusOf(discount, "2026-11-17")).toBe(expected);
  });
});

describe("ledger cursor", () => {
  it("round trips a position", () => {
    const position = { date: "2026-11-01", id: ROW };
    expect(decodeLedgerCursor(encodeLedgerCursor(position))).toEqual({ ok: true, value: position });
  });

  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

  it.each([
    ["not base64 json", "%%%"],
    ["not an array", encode({ date: "2026-11-01" })],
    ["wrong length", encode(["2026-11-01"])],
    ["date not text", encode([20261101, ROW])],
    ["id not text", encode(["2026-11-01", 5])],
    ["impossible date", encode(["2026-02-30", ROW])],
    ["id not a uuid", encode(["2026-11-01", "abc"])],
    ["too long", "a".repeat(129)],
  ])("refuses a cursor that is %s", (_name, text) => {
    const result = decodeLedgerCursor(text);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.issues).toEqual([{ path: ["cursor"], message: "Not a valid cursor" }]);
  });
});

describe("parseLedgerPage", () => {
  it("uses the default size and no cursor", () => {
    const result = parseLedgerPage({ memberId: MEMBER.toUpperCase() });
    expect(result).toEqual({ ok: true, value: { memberId: MEMBER, limit: 50, after: null } });
  });

  it("caps the page size and reads a cursor, an empty cursor means the first page", () => {
    const cursor = encodeLedgerCursor({ date: "2026-11-01", id: ROW });
    expect(parseLedgerPage({ memberId: MEMBER, limit: 100000, cursor })).toEqual({
      ok: true,
      value: { memberId: MEMBER, limit: MAX_PAGE_SIZE, after: { date: "2026-11-01", id: ROW } },
    });
    expect(parseLedgerPage({ memberId: MEMBER, cursor: "" })).toMatchObject({ ok: true });
    expect(parseLedgerPage({ memberId: MEMBER, cursor: null })).toMatchObject({ ok: true });
  });

  it("reports every problem at once", () => {
    const result = parseLedgerPage({ memberId: "nope", limit: 0, cursor: "%%%" });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error.issues.map((i) => i.path[0])).toEqual(["memberId", "limit", "cursor"]);
  });
});
