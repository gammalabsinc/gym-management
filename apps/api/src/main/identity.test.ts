import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VerifyGoogleIdToken } from "../app/google-sign-in";
import { connectDatabase, type Database } from "../infra/db/connection";
import { migrateDatabase } from "../infra/db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../infra/db/roles";
import { createTestDatabase, type TestDatabase } from "../infra/db/test-database";
import { composeApp } from "./compose";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };

interface MeRow {
  userId?: string;
  email: string;
  name?: string | null;
  roles: string[];
  permissions: string[];
  memberId?: string | null;
}
interface GymRow {
  tenantId: string;
  name: string;
  roles: string[];
}
interface UserErrorRow {
  code: string;
  message?: string;
}
interface Data {
  signIn: {
    token: string | null;
    expiresAt: string | null;
    gyms: GymRow[];
    errors: UserErrorRow[];
  };
  selectGym: {
    me: MeRow | null;
    tenant: { id: string; name: string } | null;
    errors: UserErrorRow[];
  };
  myGyms: GymRow[];
  me: MeRow;
  signOut: boolean;
}

let db: TestDatabase;
let database: Database;
let ironId: string;
let pulseId: string;

const identities: Record<string, { subject: string; email: string; name: string | null }> = {
  "owner-token": { subject: "sub-owner", email: "owner@iron.test", name: "Olga Owner" },
  "multi-token": { subject: "sub-multi", email: "multi@x.test", name: null },
  "member-token": { subject: "sub-member", email: "member@iron.test", name: "Mia Member" },
  "stranger-token": { subject: "sub-stranger", email: "stranger@nowhere.test", name: null },
};
const verifyGoogleIdToken: VerifyGoogleIdToken = async (token) => identities[token] ?? null;

async function gym(name: string): Promise<string> {
  const { rows } = await db.admin.query(
    "INSERT INTO tenants (name, subdomain, timezone, currency) VALUES ($1, $1, 'America/Toronto', 'CAD') RETURNING id",
    [name],
  );
  return (rows[0] as { id: string }).id;
}

async function person(tenantId: string, email: string, role: string): Promise<string> {
  const { rows } = await db.admin.query(
    "INSERT INTO users (tenant_id, email) VALUES ($1, $2) RETURNING id",
    [tenantId, email],
  );
  const id = (rows[0] as { id: string }).id;
  await db.admin.query("INSERT INTO user_roles (tenant_id, user_id, role) VALUES ($1, $2, $3)", [
    tenantId,
    id,
    role,
  ]);
  return id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  ironId = await gym("ironworks");
  pulseId = await gym("pulsefit");
  await person(ironId, "owner@iron.test", "owner");
  await person(ironId, "multi@x.test", "staff");
  await person(pulseId, "multi@x.test", "member");
  await person(ironId, "member@iron.test", "member");
  database = await connectDatabase(db.urlFor(APP_ROLE, PASSWORDS.appPassword));
});

afterAll(async () => {
  await database.close();
  await db.drop();
});

function app() {
  return composeApp({
    config: { logLevel: "error", nodeEnv: "test", googleClientIds: ["client-1"], sessionDays: 30 },
    database,
    write: () => {},
    verifyGoogleIdToken,
  });
}

async function call(
  query: string,
  variables: Record<string, unknown> = {},
  token?: string,
): Promise<{
  data?: Partial<Data> | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}> {
  const response = await app().graphql.fetch(
    new Request("http://localhost/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ query, variables }),
    }),
  );
  return (await response.json()) as never;
}

const SIGN_IN = `mutation($idToken: String!) { signIn(idToken: $idToken) { token expiresAt gyms { tenantId name roles } errors { code message } } }`;
const SELECT = `mutation($tenantId: ID!) { selectGym(tenantId: $tenantId) { me { userId email roles permissions memberId } tenant { id name } errors { code message } } }`;

async function signIn(idToken: string) {
  const result = await call(SIGN_IN, { idToken });
  return result.data?.signIn as {
    token: string | null;
    expiresAt: string | null;
    gyms: { tenantId: string; name: string; roles: string[] }[];
    errors: { code: string; message?: string }[];
  };
}

describe("signing in over graphql", () => {
  it("gives a session and the gyms of the person, with their roles", async () => {
    const payload = await signIn("multi-token");
    expect(payload.errors).toEqual([]);
    expect(payload.token).toEqual(expect.any(String));
    expect(Date.parse(payload.expiresAt ?? "")).toBeGreaterThan(Date.now());
    expect(payload.gyms.map((g) => [g.name, g.roles])).toEqual([
      ["ironworks", ["STAFF"]],
      ["pulsefit", ["MEMBER"]],
    ]);
  });

  it("signs a verified email with no gym in, with an empty list", async () => {
    const payload = await signIn("stranger-token");
    expect(payload.errors).toEqual([]);
    expect(payload.token).not.toBeNull();
    expect(payload.gyms).toEqual([]);
  });

  it("refuses a token Google does not vouch for, and says nothing about why", async () => {
    const payload = await signIn("forged");
    expect(payload.token).toBeNull();
    expect(payload.errors).toEqual([{ code: "FORBIDDEN", message: "Google sign in failed" }]);
  });

  it("refuses an empty token as invalid input", async () => {
    const payload = await signIn("   ");
    expect(payload.token).toBeNull();
    expect(payload.errors[0]?.code).toBe("INVALID_INPUT");
  });
});

describe("the gym list and picking a gym", () => {
  it("needs a session for myGyms", async () => {
    const result = await call("{ myGyms { name } }");
    expect(result.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
  });

  it("lists the gyms of a signed in person", async () => {
    const { token } = await signIn("owner-token");
    const result = await call("{ myGyms { name roles } }", {}, token ?? "");
    expect(result.data?.myGyms).toEqual([{ name: "ironworks", roles: ["OWNER"] }]);
  });

  it("binds the session to the gym, and then me answers from that gym", async () => {
    const { token } = await signIn("owner-token");
    const before = await call("{ me { email } }", {}, token ?? "");
    expect(before.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    const selected = await call(SELECT, { tenantId: ironId }, token ?? "");
    expect(selected.data?.selectGym?.errors).toEqual([]);
    expect(selected.data?.selectGym?.tenant).toEqual({ id: ironId, name: "ironworks" });
    expect(selected.data?.selectGym?.me).toMatchObject({
      email: "owner@iron.test",
      roles: ["OWNER"],
      memberId: null,
    });
    expect(selected.data?.selectGym?.me?.permissions).toContain("role.manage");
    const me = await call("{ me { email name roles permissions } }", {}, token ?? "");
    expect(me.data?.me).toMatchObject({
      email: "owner@iron.test",
      name: null,
      roles: ["OWNER"],
    });
  });

  it("gives a member only their own permissions", async () => {
    const { token } = await signIn("member-token");
    const selected = await call(SELECT, { tenantId: ironId }, token ?? "");
    expect(selected.data?.selectGym?.me?.roles).toEqual(["MEMBER"]);
    expect(selected.data?.selectGym?.me?.permissions).toEqual(["member.read.own"]);
  });

  it("refuses a gym where the person holds no role, and reveals nothing about it", async () => {
    const { token } = await signIn("owner-token");
    const selected = await call(SELECT, { tenantId: pulseId }, token ?? "");
    expect(selected.data?.selectGym?.me).toBeNull();
    expect(selected.data?.selectGym?.tenant).toBeNull();
    expect(selected.data?.selectGym?.errors).toEqual([
      { code: "FORBIDDEN", message: "You are not a member of this gym" },
    ]);
    const stillIdentity = await call("{ me { email } }", {}, token ?? "");
    expect(stillIdentity.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
  });

  it("treats an unknown gym id as not found", async () => {
    const { token } = await signIn("owner-token");
    const selected = await call(
      SELECT,
      { tenantId: "00000000-0000-4000-8000-000000000000" },
      token ?? "",
    );
    expect(selected.data?.selectGym?.errors[0]?.code).toBe("NOT_FOUND");
  });

  it("keeps two gyms apart: a person in both sees only the gym they picked", async () => {
    const { token } = await signIn("multi-token");
    await call(SELECT, { tenantId: pulseId }, token ?? "");
    const me = await call("{ me { roles } }", {}, token ?? "");
    expect(me.data?.me?.roles).toEqual(["MEMBER"]);
    await call(SELECT, { tenantId: ironId }, token ?? "");
    const again = await call("{ me { roles } }", {}, token ?? "");
    expect(again.data?.me?.roles).toEqual(["STAFF"]);
  });

  it("needs a session to pick a gym", async () => {
    const selected = await call(SELECT, { tenantId: ironId });
    expect(selected.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
  });
});

describe("signing out", () => {
  it("ends the session, and doing it twice is fine", async () => {
    const { token } = await signIn("owner-token");
    expect((await call("mutation { signOut }", {}, token ?? "")).data?.signOut).toBe(true);
    expect((await call("{ myGyms { name } }", {}, token ?? "")).errors?.[0]?.extensions?.code).toBe(
      "UNAUTHENTICATED",
    );
    expect((await call("mutation { signOut }", {}, token ?? "")).data?.signOut).toBe(true);
  });

  it("answers true without a token", async () => {
    expect((await call("mutation { signOut }")).data?.signOut).toBe(true);
  });
});
