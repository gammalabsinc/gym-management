import type { Client } from "../api/client";
import { query } from "../api/operation";

export interface GymContact {
  readonly name: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string | null;
}

export interface Profile {
  readonly name: string | null;
  readonly email: string;
  readonly memberNo: string;
  readonly planName: string;
  readonly joinedOn: string;
  readonly gym: GymContact;
}

export type ProfileResult =
  | { readonly status: "data"; readonly profile: Profile }
  | { readonly status: "failed"; readonly message: string };

export interface ProfileService {
  load(): Promise<ProfileResult>;
}

export const PROFILE_MISSING_MESSAGE = "We could not find your membership.";

const identityQuery = query("MyProfileIdentity", {
  me: { select: { memberId: true } },
  tenant: {
    select: {
      name: true,
      branding: { contactPhone: true, contactEmail: true, contactAddress: true },
    },
  },
});

const memberQuery = (id: string) =>
  query("MyProfile", {
    member: {
      args: { id },
      select: { memberNo: true, name: true, email: true, joinedOn: true, plan: { name: true } },
    },
  });

/** A blank value is the same as a missing one, so the screen never shows an empty link. */
function present(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export function createProfileService(deps: {
  readonly client: Pick<Client, "execute">;
}): ProfileService {
  const failed = (message: string): ProfileResult => ({ status: "failed", message });
  return {
    async load() {
      const identity = await deps.client.execute(identityQuery);
      if (identity.status === "network") return failed(identity.message);
      if (identity.status === "error") return failed(identity.error.message);
      if (identity.status === "empty") return failed(PROFILE_MISSING_MESSAGE);
      const { me, tenant } = identity.data;
      if (me.memberId === null || me.memberId === undefined) {
        return failed(PROFILE_MISSING_MESSAGE);
      }

      const result = await deps.client.execute(memberQuery(me.memberId));
      if (result.status === "network") return failed(result.message);
      if (result.status === "error") return failed(result.error.message);
      if (result.status === "empty") return failed(PROFILE_MISSING_MESSAGE);
      const member = result.data.member;
      if (member === null || member === undefined) return failed(PROFILE_MISSING_MESSAGE);

      const branding = tenant.branding;
      return {
        status: "data",
        profile: {
          name: present(member.name),
          email: member.email,
          memberNo: member.memberNo,
          planName: member.plan.name,
          joinedOn: member.joinedOn,
          gym: {
            name: tenant.name,
            phone: present(branding.contactPhone),
            email: present(branding.contactEmail),
            address: present(branding.contactAddress),
          },
        },
      };
    },
  };
}
