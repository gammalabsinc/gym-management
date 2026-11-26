import { describe, expect, it, vi } from "vitest";
import { CARD_KEY, type CachedCard, createCardCache, type KeyValueLike } from "./cache";
import { CARD_MISSING_MESSAGE, createCardService } from "./card";
import { cardStatus, statusLine } from "./present";
import { qrMatrix } from "./qr";

const card = {
  tenantId: "t1",
  gymName: "Iron Works",
  brandColor: "#112233",
  timezone: "UTC",
  currency: "USD",
  memberNo: "0042",
  barcode: "ABC123",
  name: "Sam Lee",
  status: "ACTIVE",
  standing: "PAID",
  paidThrough: "2026-12-13",
  balanceDue: 0,
} as const;

function memoryStore(initial: string | null = null) {
  let value = initial;
  const store: KeyValueLike & { value(): string | null } = {
    getItem: vi.fn(async () => value),
    setItem: vi.fn(async (_k: string, v: string) => {
      value = v;
    }),
    removeItem: vi.fn(async () => {
      value = null;
    }),
    value: () => value,
  };
  return store;
}

describe("card cache", () => {
  const cached: CachedCard = { card, updatedAt: "2026-11-26T08:00:00.000Z" };

  it("round trips and clears", async () => {
    const store = memoryStore();
    const cache = createCardCache(store);
    await cache.write(cached);
    expect(store.setItem).toHaveBeenCalledWith(CARD_KEY, expect.any(String));
    expect(await cache.read("t1")).toEqual(cached);
    await cache.clear();
    expect(await cache.read("t1")).toBeNull();
  });

  it("does not return a card from another gym", async () => {
    const cache = createCardCache(memoryStore(JSON.stringify(cached)));
    expect(await cache.read("other")).toBeNull();
  });

  it("ignores unreadable or malformed content", async () => {
    for (const raw of ["not json", "null", '{"card":null,"updatedAt":"x"}', '{"updatedAt":1}']) {
      expect(await createCardCache(memoryStore(raw)).read("t1")).toBeNull();
    }
  });

  it("survives storage failures", async () => {
    const broken: KeyValueLike = {
      getItem: async () => {
        throw new Error("x");
      },
      setItem: async () => {
        throw new Error("x");
      },
      removeItem: async () => {
        throw new Error("x");
      },
    };
    const cache = createCardCache(broken);
    expect(await cache.read("t1")).toBeNull();
    await expect(cache.write(cached)).resolves.toBeUndefined();
    await expect(cache.clear()).resolves.toBeUndefined();
  });
});

const identity = (memberId: string | null | undefined) => ({
  status: "data",
  data: {
    me: { memberId },
    tenant: {
      id: "t1",
      name: "Iron Works",
      timezone: "UTC",
      currency: "USD",
      branding: { primaryColor: "#112233" },
    },
  },
});
const memberData = (member: unknown) => ({ status: "data", data: { member } });
const member = {
  memberNo: "0042",
  barcode: "ABC123",
  name: "Sam Lee",
  status: "ACTIVE",
  standing: "PAID",
  paidThrough: "2026-12-13",
  balanceDue: 0,
};

function service(outcomes: unknown[], stored: CachedCard | null = null) {
  const queue = [...outcomes];
  const client = { execute: vi.fn(async () => queue.shift() ?? { status: "empty" }) };
  const store = memoryStore(stored === null ? null : JSON.stringify(stored));
  const svc = createCardService({
    // biome-ignore lint/suspicious/noExplicitAny: scripted outcomes
    client: client as any,
    cache: createCardCache(store),
    store: { getTenantId: () => "t1" },
    now: () => new Date("2026-11-26T09:00:00.000Z"),
  });
  return { svc, client, store };
}

describe("card service", () => {
  it("loads the card, stamps it and caches it", async () => {
    const s = service([identity("m1"), memberData(member)]);
    const result = await s.svc.load();
    expect(result).toEqual({
      status: "fresh",
      cached: { card, updatedAt: "2026-11-26T09:00:00.000Z" },
    });
    expect(s.store.value()).toContain("ABC123");
  });

  it("keeps null brand colours and names as null", async () => {
    const noBrand = {
      ...identity("m1"),
      data: {
        ...identity("m1").data,
        tenant: { ...identity("m1").data.tenant, branding: { primaryColor: null } },
      },
    };
    const s = service([noBrand, memberData({ ...member, name: null, paidThrough: null })]);
    const result = await s.svc.load();
    if (result.status !== "fresh") throw new Error("expected fresh");
    expect(result.cached.card.brandColor).toBeNull();
    expect(result.cached.card.name).toBeNull();
    expect(result.cached.card.paidThrough).toBeNull();
  });

  it("falls back to the cached card when the network is down, at either step", async () => {
    const cached: CachedCard = { card, updatedAt: "2026-11-25T08:00:00.000Z" };
    const first = service([{ status: "network", message: "offline" }], cached);
    expect(await first.svc.load()).toEqual({ status: "offline", cached });
    const second = service([identity("m1"), { status: "network", message: "offline" }], cached);
    expect(await second.svc.load()).toEqual({ status: "offline", cached });
  });

  it("fails with the network message when nothing is cached", async () => {
    const s = service([{ status: "network", message: "offline" }]);
    expect(await s.svc.load()).toEqual({ status: "failed", message: "offline" });
  });

  it("reports api errors without using the cache", async () => {
    const cached: CachedCard = { card, updatedAt: "2026-11-25T08:00:00.000Z" };
    const a = service([{ status: "error", error: { message: "nope" } }], cached);
    expect(await a.svc.load()).toEqual({ status: "failed", message: "nope" });
    const b = service([identity("m1"), { status: "error", error: { message: "nope2" } }], cached);
    expect(await b.svc.load()).toEqual({ status: "failed", message: "nope2" });
  });

  it("fails when the member or identity is missing", async () => {
    const missing = { status: "failed", message: CARD_MISSING_MESSAGE };
    expect(await service([{ status: "empty" }]).svc.load()).toEqual(missing);
    expect(await service([identity(null)]).svc.load()).toEqual(missing);
    expect(await service([identity(undefined)]).svc.load()).toEqual(missing);
    expect(await service([identity("m1"), { status: "empty" }]).svc.load()).toEqual(missing);
    expect(await service([identity("m1"), memberData(null)]).svc.load()).toEqual(missing);
    expect(await service([identity("m1"), memberData(undefined)]).svc.load()).toEqual(missing);
  });

  it("has no cached fallback before a gym is bound", async () => {
    const client = { execute: vi.fn(async () => ({ status: "network", message: "offline" })) };
    const svc = createCardService({
      // biome-ignore lint/suspicious/noExplicitAny: scripted outcomes
      client: client as any,
      cache: createCardCache(memoryStore()),
      store: { getTenantId: () => null },
      now: () => new Date(),
    });
    expect(await svc.load()).toEqual({ status: "failed", message: "offline" });
  });
});

describe("presentation", () => {
  it("maps the five statuses", () => {
    expect(cardStatus({ status: "ACTIVE", standing: "PAID" })).toBe("paid");
    expect(cardStatus({ status: "ACTIVE", standing: "DUE_SOON" })).toBe("due_soon");
    expect(cardStatus({ status: "ACTIVE", standing: "OVERDUE" })).toBe("overdue");
    expect(cardStatus({ status: "ACTIVE", standing: "INACTIVE" })).toBe("paused");
    expect(cardStatus({ status: "PAUSED", standing: "PAID" })).toBe("paused");
    expect(cardStatus({ status: "CANCELLED", standing: "OVERDUE" })).toBe("cancelled");
  });

  it("writes one line per status without date maths", () => {
    expect(statusLine(card)).toBe("Paid through Dec 13, 2026.");
    expect(statusLine({ ...card, paidThrough: null })).toBe("Your membership is paid.");
    expect(statusLine({ ...card, standing: "DUE_SOON" })).toBe(
      "Paid through Dec 13, 2026. Your next payment is due soon.",
    );
    expect(statusLine({ ...card, standing: "DUE_SOON", paidThrough: null })).toBe(
      "Your next payment is due soon.",
    );
    expect(statusLine({ ...card, standing: "OVERDUE", balanceDue: 7000 })).toBe(
      "Overdue. $70.00 is due.",
    );
    expect(statusLine({ ...card, status: "PAUSED" })).toContain("paused");
    expect(statusLine({ ...card, status: "CANCELLED" })).toBe("Your membership has ended.");
  });
});

describe("qr", () => {
  it("makes a square matrix with finder patterns", () => {
    const rows = qrMatrix("ABC123");
    expect(rows.length).toBeGreaterThanOrEqual(21);
    expect(rows.every((row) => row.modules.length === rows.length)).toBe(true);
    expect(rows[0]?.modules[0]?.dark).toBe(true);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });
});
