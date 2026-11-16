import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  makeInviteUser,
  makeListStaff,
  makeRemoveAccess,
  makeSetRole,
  type RoleManagementContext,
  type RoleManagementDeps,
} from "../../app/role-management";
import { dataSourceOptions } from "../db/data-source";
import { migrateDatabase } from "../db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../db/roles";
import { makeWithTenantTx } from "../db/tenant-tx";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { makeStaffDirectory } from "./staff-sql";
import { makeWithStaffUnit } from "./staff-unit";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };
const NOW = new Date("2026-11-16T10:00:00.000Z");

let db: TestDatabase;
let source: DataSource;
let deps: RoleManagementDeps;
let counter = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  source = new DataSource({
    ...dataSourceOptions(db.urlFor(APP_ROLE, PASSWORDS.appPassword)),
    extra: { max: 4 },
  });
  await source.initialize();
  deps = {
    clock: { now: () => NOW },
    withUnit: makeWithStaffUnit(makeWithTenantTx(source), {
      clock: { now: () => NOW },
      ids: { next: () => randomUUID() },
    }),
  };
});

afterAll(async () => {
  await source.destroy();
  await db.drop();
});

/** Fixtures go in as the superuser, which row level security does not apply to. */
async function gym(): Promise<string> {
  counter += 1;
  const { rows } = await db.admin.query(
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $1, 'America/Toronto', 'CAD') RETURNING id",
    [`gym-${counter}`],
  );
  return (rows[0] as { id: string }).id;
}

async function person(
  tenantId: string,
  roles: string[],
  options: { subject?: string | null; name?: string | null } = {},
): Promise<{ id: string; email: string; subject: string | null }> {
  counter += 1;
  const email = `person${counter}@example.com`;
  const subject = options.subject === undefined ? `sub-${counter}` : options.subject;
  const { rows } = await db.admin.query(
    "INSERT INTO users (tenant_id, email, name, auth_subject) VALUES ($1, $2, $3, $4) RETURNING id",
    [tenantId, email, options.name ?? null, subject],
  );
  const id = (rows[0] as { id: string }).id;
  for (const role of roles) {
    await db.admin.query("INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
      tenantId,
      id,
      role,
    ]);
  }
  return { id, email, subject };
}

async function session(subject: string): Promise<string> {
  const id = randomUUID();
  await db.admin.query(
    `INSERT INTO sessions (id, token_hash, auth_subject, created_at, expires_at)
     VALUES ($1, $2, $3, now(), now() + interval '1 day')`,
    [id, randomUUID().replaceAll("-", "").padEnd(64, "0"), subject],
  );
  return id;
}

async function liveSessions(subject: string): Promise<number> {
  const { rows } = await db.admin.query(
    "SELECT count(*)::int AS n FROM sessions WHERE auth_subject = $1 AND revoked_at IS NULL",
    [subject],
  );
  return (rows[0] as { n: number }).n;
}

async function rolesOf(userId: string): Promise<string[]> {
  const { rows } = await db.admin.query(
    "SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role",
    [userId],
  );
  return rows.map((row) => (row as { role: string }).role);
}

async function auditOf(tenantId: string) {
  const { rows } = await db.admin.query(
    "SELECT action, entity_id, actor_user_id, before, after, request_id FROM audit_events WHERE tenant_id = $1 ORDER BY occurred_at, id",
    [tenantId],
  );
  return rows as {
    action: string;
    entity_id: string;
    actor_user_id: string;
    before: { roles: string[] } | null;
    after: { roles: string[] };
    request_id: string;
  }[];
}

function context(tenantId: string, userId: string): RoleManagementContext {
  return { roles: ["owner"], tenantId, userId, requestId: "req-sql" };
}

describe("the staff directory", () => {
  it("lists owners and staff by email and leaves out members", async () => {
    const tenantId = await gym();
    const owner = await person(tenantId, ["owner", "member"], { name: "Olive" });
    const staff = await person(tenantId, ["staff"], { subject: null });
    await person(tenantId, ["member"]);
    await person(tenantId, []);
    const found = await source.transaction(async (manager) => {
      await manager.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      return makeStaffDirectory(
        { query: async (sql, params) => manager.query(sql, params) },
        tenantId,
      ).list();
    });
    const expected = [
      { id: owner.id, email: owner.email, roles: ["member", "owner"], subject: owner.subject },
      { id: staff.id, email: staff.email, roles: ["staff"], subject: null },
    ].sort((a, b) => a.email.localeCompare(b.email));
    expect(found.map((user) => [user.userId, user.roles, user.authSubject])).toEqual(
      expected.map((user) => [user.id, user.roles, user.subject]),
    );
    expect(found.find((user) => user.userId === owner.id)?.name).toBe("Olive");
  });
});

describe("the use cases on a real database", () => {
  it("lists the staff of the caller's gym only", async () => {
    const [mine, theirs] = [await gym(), await gym()];
    const me = await person(mine, ["owner"]);
    await person(theirs, ["owner"]);
    const result = await makeListStaff(deps)(undefined, context(mine, me.id));
    expect(result.ok && result.value.map((user) => user.userId)).toEqual([me.id]);
  });

  it("invites a new person, who stays Invited, and audits it in the same transaction", async () => {
    const tenantId = await gym();
    const owner = await person(tenantId, ["owner"]);
    const result = await makeInviteUser(deps)(
      { email: "New.Person@Example.com", name: "Nia", role: "staff" },
      context(tenantId, owner.id),
    );
    expect(result.ok && result.value).toMatchObject({
      email: "new.person@example.com",
      name: "Nia",
      roles: ["staff"],
      hasSignedIn: false,
    });
    const userId = result.ok ? result.value.userId : "";
    expect(await rolesOf(userId)).toEqual(["staff"]);
    expect(await auditOf(tenantId)).toEqual([
      {
        action: "role.assigned",
        entity_id: userId,
        actor_user_id: owner.id,
        before: null,
        after: { email: "new.person@example.com", name: "Nia", roles: ["staff"] },
        request_id: "req-sql",
      },
    ]);
  });

  it("adds a role to a member who already has a row, without a second row", async () => {
    const tenantId = await gym();
    const owner = await person(tenantId, ["owner"]);
    const member = await person(tenantId, ["member"]);
    const result = await makeInviteUser(deps)(
      { email: member.email, role: "staff" },
      context(tenantId, owner.id),
    );
    expect(result.ok && result.value.userId).toBe(member.id);
    expect(await rolesOf(member.id)).toEqual(["member", "staff"]);
  });

  it("invites into one gym only, even when the email is a user of another gym", async () => {
    const [mine, theirs] = [await gym(), await gym()];
    const owner = await person(mine, ["owner"]);
    const stranger = await person(theirs, ["member"]);
    const result = await makeInviteUser(deps)(
      { email: stranger.email, role: "owner" },
      context(mine, owner.id),
    );
    expect(result.ok && result.value.userId).not.toBe(stranger.id);
    expect(await rolesOf(stranger.id)).toEqual(["member"]);
  });

  it("cannot see or change another gym's user", async () => {
    const [mine, theirs] = [await gym(), await gym()];
    const owner = await person(mine, ["owner"]);
    const victim = await person(theirs, ["owner", "staff"]);
    const caller = context(mine, owner.id);
    const off = await makeSetRole(deps)({ userId: victim.id, role: "staff", isOn: false }, caller);
    const on = await makeSetRole(deps)({ userId: victim.id, role: "owner", isOn: true }, caller);
    const removed = await makeRemoveAccess(deps)({ userId: victim.id }, caller);
    for (const result of [off, on, removed]) {
      expect(!result.ok && result.error.kind).toBe("not_found");
    }
    expect(await rolesOf(victim.id)).toEqual(["owner", "staff"]);
    expect(await liveSessions(victim.subject ?? "")).toBe(0);
    expect(await auditOf(theirs)).toEqual([]);
  });

  it("grants and revokes a role with one audit event each", async () => {
    const tenantId = await gym();
    const owner = await person(tenantId, ["owner"]);
    const staff = await person(tenantId, ["staff"]);
    const caller = context(tenantId, owner.id);
    await makeSetRole(deps)({ userId: staff.id, role: "owner", isOn: true }, caller);
    expect(await rolesOf(staff.id)).toEqual(["owner", "staff"]);
    await makeSetRole(deps)({ userId: staff.id, role: "owner", isOn: false }, caller);
    expect(await rolesOf(staff.id)).toEqual(["staff"]);
    const events = await auditOf(tenantId);
    const summary = events
      .map((event) => [event.action, event.before?.roles, event.after.roles])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(summary).toEqual([
      ["role.assigned", ["staff"], ["owner", "staff"]],
      ["role.revoked", ["owner", "staff"], ["staff"]],
    ]);
  });

  it("will not remove or demote the last owner, and writes nothing", async () => {
    const tenantId = await gym();
    const owner = await person(tenantId, ["owner", "staff"]);
    const caller = context(tenantId, owner.id);
    const demote = await makeSetRole(deps)(
      { userId: owner.id, role: "owner", isOn: false },
      caller,
    );
    const remove = await makeRemoveAccess(deps)({ userId: owner.id }, caller);
    expect(!demote.ok && demote.error.kind).toBe("conflict");
    expect(!remove.ok && remove.error.kind).toBe("conflict");
    expect(await rolesOf(owner.id)).toEqual(["owner", "staff"]);
    expect(await auditOf(tenantId)).toEqual([]);
  });

  it("ends the sessions of a person who loses all access, and only theirs", async () => {
    const tenantId = await gym();
    const owner = await person(tenantId, ["owner"]);
    const staff = await person(tenantId, ["staff", "member"]);
    const subject = staff.subject ?? "";
    await session(subject);
    await session(subject);
    await session(owner.subject ?? "");
    const result = await makeRemoveAccess(deps)({ userId: staff.id }, context(tenantId, owner.id));
    expect(result.ok && result.value.roles).toEqual(["member"]);
    expect(await liveSessions(subject)).toBe(0);
    expect(await liveSessions(owner.subject ?? "")).toBe(1);
  });

  it("keeps the sessions of someone who still has a staff side role", async () => {
    const tenantId = await gym();
    const owner = await person(tenantId, ["owner"]);
    const both = await person(tenantId, ["owner", "staff"]);
    await session(both.subject ?? "");
    await makeSetRole(deps)(
      { userId: both.id, role: "owner", isOn: false },
      context(tenantId, owner.id),
    );
    expect(await liveSessions(both.subject ?? "")).toBe(1);
  });

  it("lets only one of two owners demote the other when they act at the same moment", async () => {
    const tenantId = await gym();
    const [a, b] = [await person(tenantId, ["owner"]), await person(tenantId, ["owner"])];
    const [first, second] = await Promise.all([
      makeSetRole(deps)({ userId: b.id, role: "owner", isOn: false }, context(tenantId, a.id)),
      makeSetRole(deps)({ userId: a.id, role: "owner", isOn: false }, context(tenantId, b.id)),
    ]);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    const owners = (await rolesOf(a.id)).length + (await rolesOf(b.id)).length;
    expect(owners).toBe(1);
  });

  it("duplicate email invites at the same moment give one user and one conflict or no-op", async () => {
    const tenantId = await gym();
    const owner = await person(tenantId, ["owner"]);
    const invite = () =>
      makeInviteUser(deps)(
        { email: "twin@example.com", role: "staff" },
        context(tenantId, owner.id),
      );
    const results = await Promise.all([invite(), invite()]);
    const { rows } = await db.admin.query(
      "SELECT count(*)::int AS n FROM users WHERE tenant_id = $1 AND email = 'twin@example.com'",
      [tenantId],
    );
    expect((rows[0] as { n: number }).n).toBe(1);
    expect(results.some((result) => result.ok)).toBe(true);
  });
});
