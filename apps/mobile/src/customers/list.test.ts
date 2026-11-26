import { describe, expect, it, vi } from "vitest";
import { createCustomersService, PAGE_SIZE } from "./list";

function service(outcome: unknown) {
  const client = { execute: vi.fn(async () => outcome) };
  // biome-ignore lint/suspicious/noExplicitAny: scripted outcome
  return { svc: createCustomersService({ client: client as any }), client };
}

const member = {
  id: "m1",
  name: "Lee Chen",
  status: "ACTIVE",
  standing: "OVERDUE",
  paidThrough: "2026-10-01",
  balanceDue: 8000,
  visitsThisMonth: 2,
  visitsLastMonth: 11,
  totalPaid: 64000,
};

const page = (items: unknown[], nextCursor: string | null = null) => ({
  status: "data",
  data: { members: { items, nextCursor }, tenant: { currency: "USD" } },
});

describe("customers service", () => {
  it("keeps the server order and adds the currency", async () => {
    const s = service(
      page([member, { ...member, id: "m0", name: null, paidThrough: null }], "next"),
    );
    const result = await s.svc.fetch({ search: "" });
    expect(result).toMatchObject({ status: "page", nextCursor: "next" });
    if (result.status !== "page") return;
    expect(result.items.map((row) => row.id)).toEqual(["m1", "m0"]);
    expect(result.items[0]).toMatchObject({ currency: "USD", balanceDue: 8000 });
    expect(result.items[1]).toMatchObject({ name: null, paidThrough: null });
  });

  it("sends the page size, the trimmed search and the cursor", async () => {
    const s = service(page([]));
    await s.svc.fetch({ search: "  lee ", cursor: "c1" });
    const sent = JSON.stringify(s.client.execute.mock.calls[0]);
    expect(sent).toContain('"lee"');
    expect(sent).toContain('"c1"');
    expect(sent).toContain(`${PAGE_SIZE}`);
  });

  it("leaves the search and the cursor out when there are none", async () => {
    const s = service(page([]));
    await s.svc.fetch({ search: "   " });
    const sent = JSON.stringify(s.client.execute.mock.calls[0]);
    expect(sent).not.toContain("search");
    expect(sent).not.toContain("cursor");
  });

  it("maps empty, network and api errors", async () => {
    expect(await service({ status: "empty" }).svc.fetch({ search: "" })).toEqual({
      status: "page",
      items: [],
      nextCursor: null,
    });
    expect(
      await service({ status: "network", message: "offline" }).svc.fetch({ search: "" }),
    ).toEqual({ status: "failed", message: "offline" });
    expect(
      await service({ status: "error", error: { message: "nope" } }).svc.fetch({ search: "" }),
    ).toEqual({ status: "failed", message: "nope" });
  });

  it("treats a missing next cursor as the end", async () => {
    const result = await service({
      status: "data",
      data: { members: { items: [member] }, tenant: { currency: "USD" } },
    }).svc.fetch({ search: "" });
    expect(result).toMatchObject({ nextCursor: null });
  });
});
