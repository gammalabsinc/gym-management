import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { VerifyGoogleIdToken } from "../app/google-sign-in";
import { connectDatabase, type Database } from "../infra/db/connection";
import { migrateDatabase } from "../infra/db/migrate";
import { APP_ROLE, MIGRATOR_ROLE, provisionRoles } from "../infra/db/roles";
import { createTestDatabase, type TestDatabase } from "../infra/db/test-database";
import { composeApp } from "./compose";
import { seedDevData } from "./seed";

const PASSWORDS = { migratorPassword: "migrator-pw", appPassword: "app-pw" };

let db: TestDatabase;
let database: Database;
const gyms = new Map<string, string>();

/** The token is the email, so a test signs in as anyone the seed made. */
const verifyGoogleIdToken: VerifyGoogleIdToken = async (token) => ({
  subject: `sub-${token}`,
  email: token,
  name: null,
});

beforeAll(async () => {
  db = await createTestDatabase();
  await provisionRoles(db.admin, PASSWORDS);
  await migrateDatabase(db.urlFor(MIGRATOR_ROLE, PASSWORDS.migratorPassword));
  const appUrl = db.urlFor(APP_ROLE, PASSWORDS.appPassword);
  for (const gym of await seedDevData(appUrl)) gyms.set(gym.subdomain, gym.tenantId);
  database = await connectDatabase(appUrl);
});

afterAll(async () => {
  await database.close();
  await db.drop();
});

interface Reply {
  data?: Record<string, unknown> | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}

const handler = () =>
  composeApp({
    config: { logLevel: "error", nodeEnv: "test", googleClientIds: ["c"], sessionDays: 30 },
    database,
    write: () => {},
    verifyGoogleIdToken,
  }).graphql;

async function post(query: string, variables: object, token?: string): Promise<Reply> {
  const response = await handler().fetch(
    new Request("http://localhost/graphql", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({ query, variables }),
    }),
  );
  return (await response.json()) as Reply;
}

function tokenOf(reply: Reply): string {
  const payload = reply.data?.signIn as { token: string } | undefined;
  if (payload === undefined) throw new Error("sign in failed in the test");
  return payload.token;
}

/** Signs in as an email and picks a gym, and returns the session token. */
async function sessionFor(email: string, subdomain: string): Promise<string> {
  const signedIn = await post("mutation($t: String!) { signIn(idToken: $t) { token } }", {
    t: email,
  });
  const token = tokenOf(signedIn);
  await post(
    "mutation($id: ID!) { selectGym(tenantId: $id) { errors { code } } }",
    { id: gyms.get(subdomain) },
    token,
  );
  return token;
}

const LIST = `query($search: String, $page: PageInput) {
  members(search: $search, page: $page) { items { id name standing status plan { name monthlyFee } } nextCursor }
}`;

interface Item {
  id: string;
  name: string;
  standing: string;
  status: string;
  plan: { name: string; monthlyFee: number };
}
const itemsOf = (reply: Reply): Item[] =>
  (reply.data?.members as { items: Item[] } | undefined)?.items ?? [];

describe("the gym and plan queries", () => {
  it("gives staff the full gym profile and gives a member only the name and contacts", async () => {
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const full = await post("{ tenant { id name subdomain timezone currency } }", {}, staff);
    expect(full.data?.tenant).toEqual({
      id: gyms.get("ironworks"),
      name: "Iron Works",
      subdomain: "ironworks",
      timezone: "America/Toronto",
      currency: "CAD",
    });
    const member = await sessionFor("paula@ironworks.test", "ironworks");
    const limited = await post("{ tenant { id name } }", {}, member);
    expect(limited.data?.tenant).toEqual({ id: gyms.get("ironworks"), name: "Iron Works" });
    const tooMuch = await post("{ tenant { timezone } }", {}, member);
    expect(tooMuch.errors).toBeDefined();
  });

  it("lists the plans of the gym only", async () => {
    const iron = await sessionFor("owner@ironworks.test", "ironworks");
    const plans = await post("{ plans { name admissionFee monthlyFee isActive } }", {}, iron);
    expect(plans.data?.plans).toEqual([
      { name: expect.any(String), admissionFee: 5000, monthlyFee: 4000, isActive: true },
    ]);
    const pulse = await sessionFor("owner@pulsefit.test", "pulsefit");
    const other = await post("{ plans { monthlyFee } }", {}, pulse);
    expect(other.data?.plans).toEqual([{ monthlyFee: 3500 }]);
  });

  it("refuses the queries of a gym without a session or before a gym is picked", async () => {
    expect((await post("{ plans { name } }", {})).errors?.[0]?.extensions?.code).toBe(
      "UNAUTHENTICATED",
    );
    const signedIn = await post("mutation($t: String!) { signIn(idToken: $t) { token } }", {
      t: "owner@ironworks.test",
    });
    const token = tokenOf(signedIn);
    expect((await post("{ plans { name } }", {}, token)).errors?.[0]?.extensions?.code).toBe(
      "FORBIDDEN",
    );
  });
});

describe("the member queries", () => {
  it("lists members overdue first for staff, and only the members of the gym", async () => {
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const items = itemsOf(await post(LIST, {}, staff));
    expect(items.map((m) => m.name)).toContain("Olga Overdue");
    expect(items.map((m) => m.name)).not.toContain("Peter Paid");
    expect(items[0]?.standing).toBe("OVERDUE");
    expect(items.find((m) => m.name === "Pavel Paused")).toMatchObject({
      status: "PAUSED",
      standing: "INACTIVE",
      plan: { monthlyFee: 4000 },
    });
  });

  it("searches by name and pages with a cursor", async () => {
    const owner = await sessionFor("owner@ironworks.test", "ironworks");
    expect(itemsOf(await post(LIST, { search: "pedro" }, owner)).map((m) => m.name)).toEqual([
      "Pedro Paid",
    ]);
    const first = await post(LIST, { page: { limit: 2 } }, owner);
    const page = first.data?.members as { items: Item[]; nextCursor: string };
    expect(page.items).toHaveLength(2);
    const second = await post(LIST, { page: { limit: 2, cursor: page.nextCursor } }, owner);
    const ids = new Set([...page.items, ...itemsOf(second)].map((m) => m.id));
    expect(ids.size).toBe(4);
  });

  it("refuses a page size below one as invalid input", async () => {
    const owner = await sessionFor("owner@ironworks.test", "ironworks");
    const reply = await post(LIST, { page: { limit: 0 } }, owner);
    expect(reply.errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
  });

  it("does not let a member list members", async () => {
    const member = await sessionFor("paula@ironworks.test", "ironworks");
    expect((await post(LIST, {}, member)).errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
  });

  it("reads one member for staff, and not from another gym", async () => {
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const [paula] = itemsOf(await post(LIST, { search: "paula" }, staff));
    const one = await post(
      "query($id: ID!) { member(id: $id) { name email memberNo billingDay referredBy { name } } }",
      { id: paula?.id },
      staff,
    );
    expect(one.data?.member).toMatchObject({
      name: "Paula Paid",
      email: "paula@ironworks.test",
      referredBy: null,
    });

    const pulseStaff = await sessionFor("staff@pulsefit.test", "pulsefit");
    const cross = await post(
      "query($id: ID!) { member(id: $id) { name } }",
      { id: paula?.id },
      pulseStaff,
    );
    expect(cross.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");
  });

  it("lets a member read their own record and nobody else's", async () => {
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const everyone = itemsOf(await post(LIST, {}, staff));
    const paula = everyone.find((m) => m.name === "Paula Paid");
    const pedro = everyone.find((m) => m.name === "Pedro Paid");
    const memberToken = await sessionFor("paula@ironworks.test", "ironworks");
    const mine = await post(
      "query($id: ID!) { member(id: $id) { name standing barcode } }",
      { id: paula?.id },
      memberToken,
    );
    expect(mine.data?.member).toMatchObject({ name: "Paula Paid", standing: "PAID" });
    const theirs = await post(
      "query($id: ID!) { member(id: $id) { name } }",
      { id: pedro?.id },
      memberToken,
    );
    expect(theirs.errors?.[0]?.extensions?.code).toBe("NOT_FOUND");
    expect(theirs.data?.member ?? null).toBeNull();
  });

  it("treats an id that is not a uuid as invalid input", async () => {
    const owner = await sessionFor("owner@ironworks.test", "ironworks");
    const reply = await post("query($id: ID!) { member(id: $id) { name } }", { id: "nope" }, owner);
    expect(reply.errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
  });
});
