/** The part of AsyncStorage used here. Passed in so tests need no native module. */
export interface KeyValueLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface CardData {
  readonly tenantId: string;
  readonly gymName: string;
  readonly brandColor: string | null;
  readonly timezone: string;
  readonly currency: string;
  readonly memberNo: string;
  readonly barcode: string;
  readonly name: string | null;
  readonly status: "ACTIVE" | "PAUSED" | "CANCELLED";
  readonly standing: "PAID" | "DUE_SOON" | "OVERDUE" | "INACTIVE";
  readonly paidThrough: string | null;
  readonly balanceDue: number;
}

export interface CachedCard {
  readonly card: CardData;
  /** When the card was last loaded from the server, as an ISO instant. */
  readonly updatedAt: string;
}

export interface CardCache {
  read(tenantId: string): Promise<CachedCard | null>;
  write(cached: CachedCard): Promise<void>;
  clear(): Promise<void>;
}

export const CARD_KEY = "gym.member-card";

function isCached(value: unknown): value is CachedCard {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const card = record.card as Record<string, unknown> | null | undefined;
  return (
    typeof record.updatedAt === "string" &&
    typeof card === "object" &&
    card !== null &&
    typeof card.tenantId === "string" &&
    typeof card.barcode === "string"
  );
}

/** The last loaded card, one per device. A card from another gym, or one that cannot be read, is not returned. */
export function createCardCache(store: KeyValueLike): CardCache {
  return {
    async read(tenantId) {
      try {
        const raw = await store.getItem(CARD_KEY);
        if (raw === null) return null;
        const parsed: unknown = JSON.parse(raw);
        return isCached(parsed) && parsed.card.tenantId === tenantId ? parsed : null;
      } catch {
        return null;
      }
    },
    async write(cached) {
      try {
        await store.setItem(CARD_KEY, JSON.stringify(cached));
      } catch {
        // The card still shows. It just will not be there offline.
      }
    },
    async clear() {
      try {
        await store.removeItem(CARD_KEY);
      } catch {
        // Nothing more to do. The next sign in overwrites it.
      }
    },
  };
}
