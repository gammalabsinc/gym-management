import { describe, expect, it } from "vitest";
import type { Role } from "../domain/permissions";
import type { AuditEvent, StaffDirectory, StaffRecord, StaffUnit } from "./ports";
import {
  makeInviteUser,
  makeListStaff,
  makeRemoveAccess,
  makeSetRole,
  type RoleManagementContext,
  type RoleManagementDeps,
} from "./role-management";

const NOW = new Date("2026-11-16T10:00:00.000Z");
const ACTOR = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const THIRD = "00000000-0000-4000-8000-0000000000c3";
const MISSING = "00000000-0000-4000-8000-0000000000ff";

const ctx: RoleManagementContext = {
  roles: ["owner"],
  tenantId: "tenant-1",
  userId: ACTOR,
  requestId: "req-1",
};

function record(userId: string, roles: Role[], authSubject: string | null = `sub-${userId}`) {
  return { userId, name: null, email: `${userId.slice(-2)}@x.co`, roles, authSubject };
}

/** An in-memory gym: what the real adapters do, without the database. */
function makeWorld(initial: StaffRecord[]) {
  const users = new Map(initial.map((user) => [user.userId, user]));
  const events: AuditEvent[] = [];
  const revoked: { subject: string; at: Date }[] = [];
  const flags = { duplicateEmail: false, roleAlreadyThere: false };
  let nextId = 1;
  const staff: StaffDirectory = {
    async list() {
      return [...users.values()].filter((user) => user.roles.some((r) => r !== "member"));
    },
    async find(userId) {
      return users.get(userId) ?? null;
    },
    async findByEmail(email) {
      return [...users.values()].find((user) => user.email === email) ?? null;
    },
    async lockOwners() {
      return [...users.values()].filter((u) => u.roles.includes("owner")).map((u) => u.userId);
    },
    async createUser({ email, name }) {
      if (flags.duplicateEmail) return null;
      const userId = `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
      users.set(userId, { userId, email, name, roles: [], authSubject: null });
      return userId;
    },
    async addRole(userId, role) {
      const user = users.get(userId);
      if (user === undefined || flags.roleAlreadyThere) return false;
      users.set(userId, { ...user, roles: [...user.roles, role] });
      return true;
    },
    async removeRole(userId, role) {
      const user = users.get(userId);
      if (user === undefined || !user.roles.includes(role)) return false;
      users.set(userId, { ...user, roles: user.roles.filter((r) => r !== role) });
      return true;
    },
  };
  const unit: StaffUnit = {
    staff,
    audit: {
      async record(event) {
        events.push(event);
      },
    },
    sessions: {
      async revokeAllForSubject(subject, at) {
        revoked.push({ subject, at });
        return 1;
      },
    },
  };
  const tenants: string[] = [];
  const deps: RoleManagementDeps = {
    clock: { now: () => NOW },
    withUnit: async (tenantId, fn) => {
      tenants.push(tenantId);
      return fn(unit);
    },
  };
  return { users, events, revoked, flags, tenants, deps };
}

function ownersAndStaff() {
  return makeWorld([
    record(ACTOR, ["owner"]),
    record(OTHER, ["owner"]),
    record(THIRD, ["staff"]),
    record("00000000-0000-4000-8000-0000000000d4", ["member"]),
  ]);
}

describe("every use case needs role.manage", () => {
  it("refuses a staff member before touching the gym", async () => {
    const world = ownersAndStaff();
    const staffCtx = { ...ctx, roles: ["staff" as const] };
    const outcomes = await Promise.all([
      makeListStaff(world.deps)(undefined, staffCtx),
      makeInviteUser(world.deps)({ email: "a@b.co", role: "staff" }, staffCtx),
      makeSetRole(world.deps)({ userId: THIRD, role: "staff", isOn: false }, staffCtx),
      makeRemoveAccess(world.deps)({ userId: THIRD }, staffCtx),
    ]);
    for (const outcome of outcomes) {
      expect(outcome).toEqual({ ok: false, error: { kind: "forbidden", message: "Not allowed" } });
    }
    expect(world.tenants).toEqual([]);
    expect(world.events).toEqual([]);
  });
});

describe("listStaff", () => {
  it("lists owners and staff with the Invited flag, in the caller's gym", async () => {
    const world = makeWorld([record(ACTOR, ["owner"]), record(THIRD, ["staff"], null)]);
    const result = await makeListStaff(world.deps)(undefined, ctx);
    expect(world.tenants).toEqual(["tenant-1"]);
    expect(result).toEqual({
      ok: true,
      value: [
        { userId: ACTOR, name: null, email: "a1@x.co", roles: ["owner"], hasSignedIn: true },
        { userId: THIRD, name: null, email: "c3@x.co", roles: ["staff"], hasSignedIn: false },
      ],
    });
  });
});

describe("inviteUser", () => {
  it("adds a new user with the role and one audit event, with no earlier row", async () => {
    const world = ownersAndStaff();
    const result = await makeInviteUser(world.deps)(
      { email: " New@Example.com ", name: " Nia ", role: "staff" },
      ctx,
    );
    expect(result.ok && result.value).toMatchObject({
      name: "Nia",
      email: "new@example.com",
      roles: ["staff"],
      hasSignedIn: false,
    });
    expect(world.events).toEqual([
      {
        actorUserId: ACTOR,
        action: "role.assigned",
        entityType: "user",
        entityId: result.ok ? result.value.userId : "",
        before: null,
        after: { email: "new@example.com", name: "Nia", roles: ["staff"] },
        requestId: "req-1",
      },
    ]);
  });

  it("gives the role to a user who already has a row, and keeps their name", async () => {
    const world = ownersAndStaff();
    world.users.set(THIRD, { ...record(THIRD, ["member"]), name: "Tess" });
    const result = await makeInviteUser(world.deps)(
      { email: "c3@x.co", name: "Other", role: "owner" },
      ctx,
    );
    expect(result.ok && result.value).toMatchObject({ name: "Tess", roles: ["member", "owner"] });
    expect(world.events).toHaveLength(1);
    expect(world.events[0]).toMatchObject({
      before: { roles: ["member"] },
      after: { roles: ["member", "owner"] },
    });
  });

  it("changes nothing when the user already holds the role", async () => {
    const world = ownersAndStaff();
    const result = await makeInviteUser(world.deps)({ email: "c3@x.co", role: "staff" }, ctx);
    expect(result.ok && result.value.roles).toEqual(["staff"]);
    expect(world.events).toEqual([]);
  });

  it("changes nothing when someone else granted the role first", async () => {
    const world = ownersAndStaff();
    world.flags.roleAlreadyThere = true;
    const result = await makeInviteUser(world.deps)({ email: "d4@x.co", role: "staff" }, ctx);
    expect(result.ok && result.value.roles).toEqual(["member"]);
    expect(world.events).toEqual([]);
  });

  it("answers a conflict when the same email was added at the same moment", async () => {
    const world = ownersAndStaff();
    world.flags.duplicateEmail = true;
    const result = await makeInviteUser(world.deps)({ email: "new@x.co", role: "staff" }, ctx);
    expect(result).toEqual({
      ok: false,
      error: { kind: "conflict", message: "This email was just added, try again" },
    });
    expect(world.events).toEqual([]);
  });

  it("rejects a bad email and the member role without opening a transaction", async () => {
    const world = ownersAndStaff();
    const result = await makeInviteUser(world.deps)({ email: "nope", role: "member" }, ctx);
    expect(result.ok).toBe(false);
    expect(world.tenants).toEqual([]);
  });
});

describe("setRole", () => {
  it("grants a role and writes role.assigned", async () => {
    const world = ownersAndStaff();
    const result = await makeSetRole(world.deps)({ userId: THIRD, role: "owner", isOn: true }, ctx);
    expect(result.ok && result.value.roles).toEqual(["owner", "staff"]);
    expect(world.events).toHaveLength(1);
    expect(world.events[0]).toMatchObject({
      action: "role.assigned",
      entityId: THIRD,
      before: { roles: ["staff"] },
      after: { roles: ["owner", "staff"] },
    });
  });

  it("granting a role that is already held is a quiet success", async () => {
    const world = ownersAndStaff();
    const result = await makeSetRole(world.deps)({ userId: THIRD, role: "staff", isOn: true }, ctx);
    expect(result.ok).toBe(true);
    expect(world.events).toEqual([]);
  });

  it("revokes a role, writes role.revoked, and keeps the sessions while access remains", async () => {
    const world = ownersAndStaff();
    world.users.set(THIRD, record(THIRD, ["owner", "staff"]));
    const result = await makeSetRole(world.deps)(
      { userId: THIRD, role: "owner", isOn: false },
      ctx,
    );
    expect(result.ok && result.value.roles).toEqual(["staff"]);
    expect(world.events.map((event) => event.action)).toEqual(["role.revoked"]);
    expect(world.revoked).toEqual([]);
  });

  it("lets an owner step down while another owner remains", async () => {
    const world = ownersAndStaff();
    const result = await makeSetRole(world.deps)(
      { userId: ACTOR, role: "owner", isOn: false },
      ctx,
    );
    expect(result.ok && result.value.roles).toEqual([]);
  });

  it("revokes the sessions at once when the last staff side role goes", async () => {
    const world = ownersAndStaff();
    await makeSetRole(world.deps)({ userId: THIRD, role: "staff", isOn: false }, ctx);
    expect(world.revoked).toEqual([{ subject: `sub-${THIRD}`, at: NOW }]);
  });

  it("has no session to revoke for a person who never signed in", async () => {
    const world = ownersAndStaff();
    world.users.set(THIRD, record(THIRD, ["staff"], null));
    const result = await makeSetRole(world.deps)(
      { userId: THIRD, role: "staff", isOn: false },
      ctx,
    );
    expect(result.ok).toBe(true);
    expect(world.revoked).toEqual([]);
  });

  it("revoking a role the user does not hold changes nothing", async () => {
    const world = ownersAndStaff();
    const result = await makeSetRole(world.deps)(
      { userId: THIRD, role: "owner", isOn: false },
      ctx,
    );
    expect(result.ok && result.value.roles).toEqual(["staff"]);
    expect(world.events).toEqual([]);
    expect(world.revoked).toEqual([]);
  });

  it("skips the event when another request removed the role first", async () => {
    const world = ownersAndStaff();
    const dir = world.deps;
    const racing: RoleManagementDeps = {
      ...dir,
      withUnit: (tenantId, fn) =>
        dir.withUnit(tenantId, (unit) =>
          fn({
            ...unit,
            staff: {
              ...unit.staff,
              find: async (id) => {
                const found = await unit.staff.find(id);
                world.users.set(THIRD, record(THIRD, []));
                return found;
              },
            },
          }),
        ),
    };
    const result = await makeSetRole(racing)({ userId: THIRD, role: "staff", isOn: false }, ctx);
    expect(result.ok && result.value.roles).toEqual(["staff"]);
    expect(world.events).toEqual([]);
    expect(world.revoked).toEqual([]);
  });

  it("refuses to demote the last owner and writes nothing", async () => {
    const world = makeWorld([record(ACTOR, ["owner"]), record(THIRD, ["staff"])]);
    const result = await makeSetRole(world.deps)(
      { userId: ACTOR, role: "owner", isOn: false },
      ctx,
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: "conflict", message: "A gym must keep at least one owner" },
    });
    expect(world.events).toEqual([]);
    expect(world.revoked).toEqual([]);
    expect(world.users.get(ACTOR)?.roles).toEqual(["owner"]);
  });

  it("answers not found for an unknown user, on and off", async () => {
    const world = ownersAndStaff();
    for (const isOn of [true, false]) {
      const result = await makeSetRole(world.deps)({ userId: MISSING, role: "staff", isOn }, ctx);
      expect(result).toEqual({
        ok: false,
        error: { kind: "not_found", message: "User not found" },
      });
    }
  });

  it("rejects the member role and a malformed id before opening a transaction", async () => {
    const world = ownersAndStaff();
    const member = await makeSetRole(world.deps)(
      { userId: THIRD, role: "member", isOn: true },
      ctx,
    );
    const badId = await makeSetRole(world.deps)({ userId: "x", role: "staff", isOn: true }, ctx);
    expect(member.ok).toBe(false);
    expect(badId.ok).toBe(false);
    expect(world.tenants).toEqual([]);
  });
});

describe("removeAccess", () => {
  it("takes every staff side role, one event each, and ends the sessions", async () => {
    const world = ownersAndStaff();
    world.users.set(THIRD, record(THIRD, ["member", "owner", "staff"]));
    const result = await makeRemoveAccess(world.deps)({ userId: THIRD }, ctx);
    expect(result.ok && result.value.roles).toEqual(["member"]);
    expect(world.events.map((event) => [event.action, event.after])).toEqual([
      ["role.revoked", { email: "c3@x.co", name: null, roles: ["member", "staff"] }],
      ["role.revoked", { email: "c3@x.co", name: null, roles: ["member"] }],
    ]);
    expect(world.revoked).toEqual([{ subject: `sub-${THIRD}`, at: NOW }]);
  });

  it("refuses when the user is the last owner", async () => {
    const world = makeWorld([record(ACTOR, ["owner", "staff"])]);
    const result = await makeRemoveAccess(world.deps)({ userId: ACTOR }, ctx);
    expect(result.ok).toBe(false);
    expect(world.users.get(ACTOR)?.roles).toEqual(["owner", "staff"]);
    expect(world.events).toEqual([]);
  });

  it("answers not found for an unknown user and invalid for a malformed id", async () => {
    const world = ownersAndStaff();
    const missing = await makeRemoveAccess(world.deps)({ userId: MISSING }, ctx);
    const malformed = await makeRemoveAccess(world.deps)({ userId: "x" }, ctx);
    expect(missing.ok).toBe(false);
    expect(!malformed.ok && malformed.error.kind).toBe("validation");
  });
});
