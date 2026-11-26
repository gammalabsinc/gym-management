import type { Client } from "../api/client";
import { query } from "../api/operation";
import type { SessionStore } from "../auth/session-store";
import type { CachedCard, CardCache, CardData } from "./cache";

export type CardResult =
  | { readonly status: "fresh"; readonly cached: CachedCard }
  /** The server could not be reached, so this is the last loaded card. */
  | { readonly status: "offline"; readonly cached: CachedCard }
  | { readonly status: "failed"; readonly message: string };

export interface CardService {
  load(): Promise<CardResult>;
}

export const CARD_MISSING_MESSAGE = "We could not find your membership card.";

const identityQuery = query("MyCardIdentity", {
  me: { select: { memberId: true } },
  tenant: {
    select: {
      id: true,
      name: true,
      timezone: true,
      currency: true,
      branding: { primaryColor: true },
    },
  },
});

const memberQuery = (id: string) =>
  query("MyCard", {
    member: {
      args: { id },
      select: {
        memberNo: true,
        barcode: true,
        name: true,
        status: true,
        standing: true,
        paidThrough: true,
        balanceDue: true,
      },
    },
  });

export function createCardService(deps: {
  readonly client: Pick<Client, "execute">;
  readonly cache: CardCache;
  readonly store: Pick<SessionStore, "getTenantId">;
  readonly now: () => Date;
}): CardService {
  const failed = (message: string): CardResult => ({ status: "failed", message });

  async function offlineOr(message: string, tenantId: string | null): Promise<CardResult> {
    const cached = tenantId === null ? null : await deps.cache.read(tenantId);
    return cached === null ? failed(message) : { status: "offline", cached };
  }

  return {
    async load() {
      const tenantId = deps.store.getTenantId();
      const identity = await deps.client.execute(identityQuery);
      if (identity.status === "network") return offlineOr(identity.message, tenantId);
      if (identity.status === "error") return failed(identity.error.message);
      if (identity.status === "empty") return failed(CARD_MISSING_MESSAGE);
      const { me, tenant } = identity.data;
      if (me.memberId === null || me.memberId === undefined) return failed(CARD_MISSING_MESSAGE);

      const result = await deps.client.execute(memberQuery(me.memberId));
      if (result.status === "network") return offlineOr(result.message, tenantId);
      if (result.status === "error") return failed(result.error.message);
      if (result.status === "empty") return failed(CARD_MISSING_MESSAGE);
      const member = result.data.member;
      if (member === null || member === undefined) return failed(CARD_MISSING_MESSAGE);

      const card: CardData = {
        tenantId: tenant.id,
        gymName: tenant.name,
        brandColor: tenant.branding.primaryColor ?? null,
        timezone: tenant.timezone,
        currency: tenant.currency,
        memberNo: member.memberNo,
        barcode: member.barcode,
        name: member.name ?? null,
        status: member.status,
        standing: member.standing,
        paidThrough: member.paidThrough ?? null,
        balanceDue: member.balanceDue,
      };
      const cached: CachedCard = { card, updatedAt: deps.now().toISOString() };
      await deps.cache.write(cached);
      return { status: "fresh", cached };
    },
  };
}
