import type { Client } from "../api/client";
import { mutation, query } from "../api/operation";

export interface GymFees {
  readonly planId: string;
  readonly planName: string;
  readonly currency: string;
  readonly timezone: string;
  readonly admissionFee: number;
  readonly monthlyFee: number;
}

export interface MemberDetails {
  readonly id: string;
  readonly memberNo: string;
  readonly name: string | null;
  readonly email: string;
  readonly phone: string | null;
  readonly planName: string;
  readonly joinedOn: string;
  readonly referredByName: string | null;
}

export interface Referrer {
  readonly id: string;
  readonly name: string | null;
  readonly email: string;
}

export interface NewMember {
  readonly name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly planId: string;
  readonly joinedOn: string;
  readonly referredById: string | null;
}

export interface ProfilePatch {
  readonly name: string;
  readonly phone: string | null;
}

export type Loaded<T> =
  | { readonly status: "loaded"; readonly data: T }
  | { readonly status: "forbidden" }
  | { readonly status: "failed"; readonly message: string };

export interface FieldProblem {
  readonly field: string | null;
  readonly code: string;
  readonly message: string;
}

export type SaveResult =
  | { readonly status: "saved"; readonly memberId: string }
  | { readonly status: "invalid"; readonly problems: readonly FieldProblem[] }
  | { readonly status: "forbidden" }
  | { readonly status: "failed"; readonly message: string };

export interface MembersService {
  /** The gym's current fees, for the first invoice preview. */
  loadFees(): Promise<Loaded<GymFees>>;
  loadMember(id: string): Promise<Loaded<MemberDetails>>;
  /** At most a few people matching the text, for the referred by field. */
  searchReferrers(term: string): Promise<Loaded<readonly Referrer[]>>;
  create(input: NewMember): Promise<SaveResult>;
  update(id: string, patch: ProfilePatch): Promise<SaveResult>;
}

export const LOAD_FAILED_MESSAGE = "We could not load this. Try again.";
export const SAVE_FAILED_MESSAGE = "We could not save the member. Try again.";
export const REFERRER_LIMIT = 5;

const feesQuery = query("MemberFees", {
  plans: { select: { id: true, name: true, admissionFee: true, monthlyFee: true, isActive: true } },
  tenant: { select: { currency: true, timezone: true } },
});

const memberQuery = (id: string) =>
  query("MemberToEdit", {
    member: {
      args: { id },
      select: {
        id: true,
        memberNo: true,
        name: true,
        email: true,
        phone: true,
        joinedOn: true,
        plan: { name: true },
        referredBy: { name: true },
      },
    },
  });

const referrersQuery = (term: string) =>
  query("Referrers", {
    members: {
      args: { search: term, page: { limit: REFERRER_LIMIT } },
      select: { items: { id: true, name: true, email: true } },
    },
  });

const createMutation = (input: NewMember) =>
  mutation("CreateMember", {
    createMember: {
      args: {
        input: {
          name: input.name,
          email: input.email,
          planId: input.planId,
          joinedOn: input.joinedOn,
          ...(input.phone === null ? {} : { phone: input.phone }),
          ...(input.referredById === null ? {} : { referredById: input.referredById }),
        },
      },
      select: {
        member: { id: true },
        errors: { code: true, field: true, message: true },
      },
    },
  });

const updateMutation = (id: string, patch: ProfilePatch) =>
  mutation("UpdateMember", {
    updateMember: {
      args: { id, patch: { name: patch.name, phone: patch.phone } },
      select: {
        member: { id: true },
        errors: { code: true, field: true, message: true },
      },
    },
  });

type Failure = { readonly status: "forbidden" } | { readonly status: "failed"; message: string };

/** The part of an outcome that is not data, shared by the loads. */
function failureOf(outcome: {
  readonly status: "network" | "error" | "empty";
  readonly message?: string;
  readonly error?: { readonly code: string; readonly message: string };
}): Failure {
  if (outcome.status === "network") {
    return { status: "failed", message: outcome.message ?? LOAD_FAILED_MESSAGE };
  }
  if (outcome.status === "error") {
    return outcome.error?.code === "FORBIDDEN"
      ? { status: "forbidden" }
      : { status: "failed", message: outcome.error?.message ?? LOAD_FAILED_MESSAGE };
  }
  return { status: "failed", message: LOAD_FAILED_MESSAGE };
}

interface Reported {
  readonly code: string;
  readonly field?: string | null;
  readonly message: string;
}

function toSave(
  outcome: {
    readonly status: string;
    readonly message?: string;
    readonly error?: { readonly code: string; readonly message: string };
  },
  payload: { readonly memberId: string | null; readonly errors: readonly Reported[] } | null,
): SaveResult {
  if (outcome.status === "network") {
    return { status: "failed", message: outcome.message ?? SAVE_FAILED_MESSAGE };
  }
  if (outcome.status === "error") {
    return outcome.error?.code === "FORBIDDEN"
      ? { status: "forbidden" }
      : { status: "failed", message: outcome.error?.message ?? SAVE_FAILED_MESSAGE };
  }
  if (payload === null) return { status: "failed", message: SAVE_FAILED_MESSAGE };
  if (payload.errors.some((error) => error.code === "FORBIDDEN")) return { status: "forbidden" };
  if (payload.errors.length > 0) {
    return {
      status: "invalid",
      problems: payload.errors.map((error) => ({
        field: error.field ?? null,
        code: error.code,
        message: error.message,
      })),
    };
  }
  // No errors and no member would be a server fault. It must never read as a saved member.
  if (payload.memberId === null) return { status: "failed", message: SAVE_FAILED_MESSAGE };
  return { status: "saved", memberId: payload.memberId };
}

export function createMembersService(deps: {
  readonly client: Pick<Client, "execute">;
}): MembersService {
  return {
    async loadFees() {
      const outcome = await deps.client.execute(feesQuery);
      if (outcome.status !== "data") return failureOf(outcome);
      // Each gym has one default plan, and a new member joins it.
      const plan = outcome.data.plans.find((candidate) => candidate.isActive);
      if (plan === undefined) return { status: "failed", message: LOAD_FAILED_MESSAGE };
      const { currency, timezone } = outcome.data.tenant;
      return {
        status: "loaded",
        data: {
          planId: plan.id,
          planName: plan.name,
          currency,
          timezone,
          admissionFee: plan.admissionFee,
          monthlyFee: plan.monthlyFee,
        },
      };
    },

    async loadMember(id) {
      const outcome = await deps.client.execute(memberQuery(id));
      if (outcome.status !== "data") return failureOf(outcome);
      const member = outcome.data.member;
      if (member === null) return { status: "failed", message: LOAD_FAILED_MESSAGE };
      return {
        status: "loaded",
        data: {
          id: member.id,
          memberNo: member.memberNo,
          name: member.name ?? null,
          email: member.email,
          phone: member.phone ?? null,
          planName: member.plan.name,
          joinedOn: member.joinedOn,
          referredByName: member.referredBy?.name ?? null,
        },
      };
    },

    async searchReferrers(term) {
      const outcome = await deps.client.execute(referrersQuery(term.trim()));
      if (outcome.status === "empty") return { status: "loaded", data: [] };
      if (outcome.status !== "data") return failureOf(outcome);
      return {
        status: "loaded",
        data: outcome.data.members.items.map((item) => ({
          id: item.id,
          name: item.name ?? null,
          email: item.email,
        })),
      };
    },

    async create(input) {
      const outcome = await deps.client.execute(createMutation(input));
      const payload = outcome.status === "data" ? outcome.data.createMember : null;
      return toSave(
        outcome,
        payload === null ? null : { memberId: payload.member?.id ?? null, errors: payload.errors },
      );
    },

    async update(id, patch) {
      const outcome = await deps.client.execute(updateMutation(id, patch));
      const payload = outcome.status === "data" ? outcome.data.updateMember : null;
      return toSave(
        outcome,
        payload === null ? null : { memberId: payload.member?.id ?? null, errors: payload.errors },
      );
    },
  };
}
