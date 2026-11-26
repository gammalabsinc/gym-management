import type { Client } from "./api/client";
import { mutation, query } from "./api/operation";
import type { Role } from "./auth/session";
import type { SessionStore } from "./auth/session-store";

export interface GymChoice {
  readonly tenantId: string;
  readonly name: string;
  readonly roles: readonly Role[];
}

export type GymList =
  | { readonly status: "gyms"; readonly gyms: readonly GymChoice[] }
  | { readonly status: "none" }
  | { readonly status: "failed"; readonly message: string };

export type SelectResult =
  | { readonly status: "entered" }
  | { readonly status: "failed"; readonly message: string };

export interface Gyms {
  list(): Promise<GymList>;
  /** Binds the gym on the server. The role comes from the server's answer, never from this device. */
  select(tenantId: string): Promise<SelectResult>;
  /** After a forbidden answer: if the gym is gone from the list, or the role changed, follow the server. */
  recheck(): Promise<void>;
}

export const SELECT_FAILED_MESSAGE = "We could not open that gym. Try again.";

const RANK: readonly Role[] = ["owner", "staff", "member"];

function toRole(role: string): Role {
  return role.toLowerCase() as Role;
}

/** The most powerful role a person holds in a gym decides the view. Null when they hold none. */
export function highestRole(roles: readonly string[]): Role | null {
  const held = roles.map(toRole);
  return RANK.find((role) => held.includes(role)) ?? null;
}

const myGymsQuery = query("MyGyms", {
  myGyms: { select: { tenantId: true, name: true, roles: true } },
});

const selectGymMutation = (tenantId: string) =>
  mutation("SelectGym", {
    selectGym: {
      args: { tenantId },
      select: { me: { roles: true }, tenant: { id: true }, errors: { code: true } },
    },
  });

export function createGyms(deps: {
  readonly client: Pick<Client, "execute">;
  readonly store: SessionStore;
}): Gyms {
  async function list(): Promise<GymList> {
    const outcome = await deps.client.execute(myGymsQuery);
    switch (outcome.status) {
      case "network":
        return { status: "failed", message: outcome.message };
      case "error":
        return { status: "failed", message: outcome.error.message };
      case "empty":
        return { status: "none" };
      case "data":
        return {
          status: "gyms",
          gyms: outcome.data.myGyms.map((gym) => ({
            tenantId: gym.tenantId,
            name: gym.name,
            roles: gym.roles.map(toRole),
          })),
        };
    }
  }

  let checking = false;
  const failed = (message: string): SelectResult => ({ status: "failed", message });

  return {
    list,

    async select(tenantId) {
      const outcome = await deps.client.execute(selectGymMutation(tenantId));
      if (outcome.status === "network") return failed(outcome.message);
      if (outcome.status === "error") return failed(outcome.error.message);
      if (outcome.status === "empty") return failed(SELECT_FAILED_MESSAGE);
      const payload = outcome.data.selectGym;
      const role =
        payload.me === null || payload.me === undefined ? null : highestRole(payload.me.roles);
      const confirmed = payload.tenant?.id;
      if (payload.errors.length > 0 || role === null || confirmed === undefined) {
        return failed(SELECT_FAILED_MESSAGE);
      }
      deps.store.enterGym(role, confirmed);
      return { status: "entered" };
    },

    async recheck() {
      const tenantId = deps.store.getTenantId();
      if (tenantId === null || checking) return;
      checking = true;
      const result = await list().finally(() => {
        checking = false;
      });
      if (result.status === "failed") return;
      const gym =
        result.status === "gyms" ? result.gyms.find((g) => g.tenantId === tenantId) : undefined;
      const role = gym === undefined ? null : highestRole(gym.roles);
      if (role === null) deps.store.leaveGym();
      else deps.store.enterGym(role, tenantId);
    },
  };
}
