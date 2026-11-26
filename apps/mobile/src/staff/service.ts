import type { Client } from "../api/client";
import { mutation, query } from "../api/operation";

export type StaffRole = "owner" | "staff";

export interface StaffPerson {
  readonly userId: string;
  readonly name: string | null;
  readonly email: string;
  /** Owner when the person holds the owner role, otherwise staff. */
  readonly role: StaffRole;
  /** False until the person signs in for the first time. */
  readonly hasSignedIn: boolean;
}

export type StaffList =
  | { readonly status: "loaded"; readonly people: readonly StaffPerson[] }
  | { readonly status: "forbidden" }
  | { readonly status: "failed"; readonly message: string };

export interface FieldProblem {
  readonly field: string | null;
  readonly code: string;
  readonly message: string;
}

export type ChangeResult =
  | { readonly status: "done" }
  | { readonly status: "invalid"; readonly problems: readonly FieldProblem[] }
  /** The server refused to remove the last owner, for example because two owners acted at once. */
  | { readonly status: "lastOwner"; readonly message: string }
  | { readonly status: "forbidden" }
  | { readonly status: "failed"; readonly message: string };

export interface StaffService {
  list(): Promise<StaffList>;
  invite(input: {
    readonly email: string;
    readonly name: string;
    readonly role: StaffRole;
  }): Promise<ChangeResult>;
  /** Owner on or off for one person. Switching to staff first makes sure they keep the staff role. */
  setRole(person: StaffPerson, role: StaffRole): Promise<ChangeResult>;
  removeAccess(userId: string): Promise<ChangeResult>;
}

export const CHANGE_FAILED_MESSAGE = "We could not save that change. Try again.";
export const LOAD_FAILED_MESSAGE = "We could not load the staff.";

const staffQuery = query("StaffList", {
  staff: { select: { userId: true, name: true, email: true, roles: true, hasSignedIn: true } },
});

const problemFields = { code: true, field: true, message: true } as const;

const inviteMutation = (email: string, name: string, role: "OWNER" | "STAFF") =>
  mutation("InviteUser", {
    inviteUser: {
      args: { email, role, ...(name === "" ? {} : { name }) },
      select: { user: { userId: true }, errors: problemFields },
    },
  });

const setRoleMutation = (userId: string, role: "OWNER" | "STAFF", isOn: boolean) =>
  mutation("SetRole", {
    setRole: {
      args: { userId, role, isOn },
      select: { user: { userId: true }, errors: problemFields },
    },
  });

const removeMutation = (userId: string) =>
  mutation("RemoveAccess", {
    removeAccess: { args: { userId }, select: { user: { userId: true }, errors: problemFields } },
  });

interface Reported {
  readonly code: string;
  readonly field?: string | null;
  readonly message: string;
}

type Outcome =
  | { readonly status: "network"; readonly message: string }
  | {
      readonly status: "error";
      readonly error: { readonly code: string; readonly message: string };
    }
  | { readonly status: "empty" }
  | { readonly status: "data" };

function toChange(outcome: Outcome, errors: readonly Reported[] | null): ChangeResult {
  if (outcome.status === "network") return { status: "failed", message: outcome.message };
  if (outcome.status === "error") {
    return outcome.error.code === "FORBIDDEN"
      ? { status: "forbidden" }
      : { status: "failed", message: outcome.error.message };
  }
  if (errors === null) return { status: "failed", message: CHANGE_FAILED_MESSAGE };
  if (errors.some((error) => error.code === "FORBIDDEN")) return { status: "forbidden" };
  const last = errors.find((error) => error.code === "LAST_OWNER");
  if (last !== undefined) return { status: "lastOwner", message: last.message };
  if (errors.length > 0) {
    return {
      status: "invalid",
      problems: errors.map((error) => ({
        field: error.field ?? null,
        code: error.code,
        message: error.message,
      })),
    };
  }
  return { status: "done" };
}

export function createStaffService(deps: {
  readonly client: Pick<Client, "execute">;
}): StaffService {
  const { client } = deps;

  async function setRole(
    userId: string,
    role: "OWNER" | "STAFF",
    isOn: boolean,
  ): Promise<ChangeResult> {
    const outcome = await client.execute(setRoleMutation(userId, role, isOn));
    return toChange(outcome, outcome.status === "data" ? outcome.data.setRole.errors : null);
  }

  return {
    async list() {
      const outcome = await client.execute(staffQuery);
      if (outcome.status === "network") return { status: "failed", message: outcome.message };
      if (outcome.status === "error") {
        return outcome.error.code === "FORBIDDEN"
          ? { status: "forbidden" }
          : { status: "failed", message: outcome.error.message };
      }
      if (outcome.status === "empty") return { status: "loaded", people: [] };
      return {
        status: "loaded",
        people: outcome.data.staff.map((user) => ({
          userId: user.userId,
          name: user.name ?? null,
          email: user.email,
          role: user.roles.includes("OWNER") ? "owner" : "staff",
          hasSignedIn: user.hasSignedIn,
        })),
      };
    },

    async invite(input) {
      const outcome = await client.execute(
        inviteMutation(
          input.email.trim(),
          input.name.trim(),
          input.role === "owner" ? "OWNER" : "STAFF",
        ),
      );
      return toChange(outcome, outcome.status === "data" ? outcome.data.inviteUser.errors : null);
    },

    async setRole(person, role) {
      if (role === "owner") return setRole(person.userId, "OWNER", true);
      // Owner and staff are separate roles. Keep the staff role first, then take the owner role.
      const kept = await setRole(person.userId, "STAFF", true);
      if (kept.status !== "done") return kept;
      return setRole(person.userId, "OWNER", false);
    },

    async removeAccess(userId) {
      const outcome = await client.execute(removeMutation(userId));
      return toChange(outcome, outcome.status === "data" ? outcome.data.removeAccess.errors : null);
    },
  };
}
