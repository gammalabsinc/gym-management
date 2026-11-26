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

interface UserErrorRow {
  code: string;
  field: string | null;
  message: string;
}
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

async function sessionFor(email: string, subdomain: string): Promise<string> {
  const signedIn = await post("mutation($t: String!) { signIn(idToken: $t) { token } }", {
    t: email,
  });
  const token = (signedIn.data?.signIn as { token: string } | undefined)?.token ?? "";
  await post(
    "mutation($id: ID!) { selectGym(tenantId: $id) { errors { code } } }",
    { id: gyms.get(subdomain) },
    token,
  );
  return token;
}

const payloadOf = <T>(reply: Reply, field: string): T => {
  const payload = reply.data?.[field];
  if (payload === undefined || payload === null)
    throw new Error(`no ${field}: ${JSON.stringify(reply)}`);
  return payload as T;
};

async function memberByName(token: string, name: string) {
  const reply = await post(
    "query($s: String) { members(search: $s) { items { id name barcode } } }",
    { s: name },
    token,
  );
  const items = payloadOf<{ items: { id: string; name: string; barcode: string }[] }>(
    reply,
    "members",
  ).items;
  const found = items.find((m) => m.name === name);
  if (found === undefined) throw new Error(`no member ${name}`);
  return found;
}

const ADD = `mutation($input: DiscountInput!) {
  addDiscount(input: $input) { discount { id amount isActive isRecurring reason } errors { code field message } }
}`;
const END = `mutation($id: ID!, $r: String!) {
  endDiscount(id: $id, reason: $r) { discount { id endsOn } errors { code field message } }
}`;

type DiscountPayload = {
  discount: { id: string; amount: number; isActive: boolean; endsOn?: string } | null;
  errors: UserErrorRow[];
};

describe("discounts", () => {
  it("lets the owner add and end a discount, and keeps staff out", async () => {
    const owner = await sessionFor("owner@ironworks.test", "ironworks");
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const member = await memberByName(owner, "Paula Paid");
    const input = { memberId: member.id, amount: 500, isRecurring: true, reason: "Loyalty" };

    const denied = await post(ADD, { input }, staff);
    expect(denied.errors?.[0]?.extensions?.code ?? denied.data?.addDiscount).toBeTruthy();
    if (denied.data?.addDiscount) {
      expect(payloadOf<DiscountPayload>(denied, "addDiscount").errors[0]?.code).toBe("FORBIDDEN");
    }

    const added = payloadOf<DiscountPayload>(await post(ADD, { input }, owner), "addDiscount");
    expect(added.errors).toEqual([]);
    expect(added.discount).toMatchObject({ amount: 500, isActive: true });

    const ended = payloadOf<DiscountPayload>(
      await post(END, { id: added.discount?.id, r: "Promotion over" }, owner),
      "endDiscount",
    );
    expect(ended.errors).toEqual([]);
    expect(ended.discount?.endsOn).toBeTruthy();
  });

  it("does not let another gym's owner touch the member or the discount", async () => {
    const owner = await sessionFor("owner@ironworks.test", "ironworks");
    const other = await sessionFor("owner@pulsefit.test", "pulsefit");
    const member = await memberByName(owner, "Pedro Paid");
    const input = { memberId: member.id, amount: 300, isRecurring: true, reason: "Cross" };
    const crossed = payloadOf<DiscountPayload>(await post(ADD, { input }, other), "addDiscount");
    expect(crossed.discount).toBeNull();
    expect(crossed.errors[0]?.code).toBe("NOT_FOUND");

    const added = payloadOf<DiscountPayload>(await post(ADD, { input }, owner), "addDiscount");
    const stolen = payloadOf<DiscountPayload>(
      await post(END, { id: added.discount?.id, r: "nope" }, other),
      "endDiscount",
    );
    expect(stolen.discount).toBeNull();
    expect(stolen.errors[0]?.code).toBe("NOT_FOUND");
  });
});

describe("plans and settings", () => {
  it("lets the owner update a plan and the settings", async () => {
    const owner = await sessionFor("owner@ironworks.test", "ironworks");
    const plans = payloadOf<{ id: string }[]>(await post("{ plans { id } }", {}, owner), "plans");
    const plan = await post(
      `mutation($id: ID!, $i: PlanInput!) { updatePlan(id: $id, input: $i) { plan { name monthlyFee admissionFee } errors { code } } }`,
      { id: plans[0]?.id, i: { name: "Gold", admissionFee: 1000, monthlyFee: 8000 } },
      owner,
    );
    expect(payloadOf<{ plan: object; errors: unknown[] }>(plan, "updatePlan")).toMatchObject({
      plan: { name: "Gold", monthlyFee: 8000, admissionFee: 1000 },
      errors: [],
    });

    const settings = await post(
      `mutation($i: SettingsInput!) { updateSettings(input: $i) { tenant { settings { warnDaysBefore } } errors { code field } } }`,
      { i: { warnDaysBefore: 5 } },
      owner,
    );
    expect(
      payloadOf<{ tenant: { settings: { warnDaysBefore: number } } }>(settings, "updateSettings")
        .tenant.settings.warnDaysBefore,
    ).toBe(5);

    const invalid = await post(
      `mutation($i: SettingsInput!) { updateSettings(input: $i) { tenant { name } errors { code field } } }`,
      { i: { warnDaysBefore: -1 } },
      owner,
    );
    expect(payloadOf<{ errors: UserErrorRow[] }>(invalid, "updateSettings").errors[0]?.code).toBe(
      "INVALID_INPUT",
    );
  });

  it("refuses staff and members", async () => {
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const reply = await post(
      `mutation($i: SettingsInput!) { updateSettings(input: $i) { tenant { name } errors { code } } }`,
      { i: { warnDaysBefore: 4 } },
      staff,
    );
    const payload = reply.data?.updateSettings as { errors: UserErrorRow[] } | null | undefined;
    expect(payload?.errors[0]?.code ?? reply.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
  });
});

const STAFF_FIELDS = "userId email roles hasSignedIn";
type StaffPayload = {
  user: { userId: string; email: string; roles: string[]; hasSignedIn: boolean } | null;
  errors: UserErrorRow[];
};

describe("staff", () => {
  it("lists, invites, changes roles and removes access", async () => {
    const owner = await sessionFor("owner@ironworks.test", "ironworks");
    const list = payloadOf<{ email: string }[]>(
      await post(`{ staff { ${STAFF_FIELDS} } }`, {}, owner),
      "staff",
    );
    expect(list.map((s) => s.email)).toContain("staff@ironworks.test");

    const invited = payloadOf<StaffPayload>(
      await post(
        `mutation { inviteUser(email: "new.coach@ironworks.test", name: "Coach", role: STAFF) { user { ${STAFF_FIELDS} } errors { code field } } }`,
        {},
        owner,
      ),
      "inviteUser",
    );
    expect(invited.errors).toEqual([]);
    expect(invited.user).toMatchObject({ roles: ["STAFF"], hasSignedIn: false });

    const userId = invited.user?.userId ?? "";
    const promoted = payloadOf<StaffPayload>(
      await post(
        `mutation($u: ID!) { setRole(userId: $u, role: OWNER, isOn: true) { user { roles } errors { code } } }`,
        { u: userId },
        owner,
      ),
      "setRole",
    );
    expect(promoted.user?.roles).toEqual(expect.arrayContaining(["OWNER", "STAFF"]));

    const removed = payloadOf<StaffPayload>(
      await post(
        `mutation($u: ID!) { removeAccess(userId: $u) { user { roles } errors { code } } }`,
        { u: userId },
        owner,
      ),
      "removeAccess",
    );
    expect(removed.errors).toEqual([]);
    expect(removed.user?.roles).toEqual([]);
  });

  it("refuses to drop the last owner", async () => {
    const owner = await sessionFor("owner@pulsefit.test", "pulsefit");
    const list = payloadOf<{ userId: string; email: string }[]>(
      await post(`{ staff { userId email } }`, {}, owner),
      "staff",
    );
    const self = list.find((s) => s.email === "owner@pulsefit.test");
    const reply = await post(
      `mutation($u: ID!) { removeAccess(userId: $u) { user { roles } errors { code } } }`,
      { u: self?.userId },
      owner,
    );
    expect(payloadOf<StaffPayload>(reply, "removeAccess").errors[0]?.code).toBe("LAST_OWNER");
  });

  it("keeps staff from reading the staff list", async () => {
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const reply = await post(`{ staff { userId } }`, {}, staff);
    expect(reply.errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
  });
});

const SCAN = `mutation($b: String!) {
  recordScan(barcode: $b) { visit { isDuplicate } member { name } errors { code field message } }
}`;
type ScanPayload = {
  visit: { isDuplicate: boolean } | null;
  member: { name: string } | null;
  errors: UserErrorRow[];
};

describe("recordScan", () => {
  it("checks a member in, flags the repeat, and reports an unknown code", async () => {
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const member = await memberByName(staff, "Dana Due");
    const first = payloadOf<ScanPayload>(
      await post(SCAN, { b: member.barcode }, staff),
      "recordScan",
    );
    expect(first.errors).toEqual([]);
    expect(first.member?.name).toBe("Dana Due");
    expect(first.visit?.isDuplicate).toBe(false);

    const second = payloadOf<ScanPayload>(
      await post(SCAN, { b: member.barcode }, staff),
      "recordScan",
    );
    expect(second.visit?.isDuplicate).toBe(true);

    const unknown = payloadOf<ScanPayload>(
      await post(SCAN, { b: "NOPE-0000" }, staff),
      "recordScan",
    );
    expect(unknown.errors[0]).toMatchObject({ code: "NOT_FOUND", field: "barcode" });
  });

  it("does not find a barcode that belongs to another gym", async () => {
    const owner = await sessionFor("owner@ironworks.test", "ironworks");
    const other = await sessionFor("staff@pulsefit.test", "pulsefit");
    const member = await memberByName(owner, "Olga Overdue");
    const reply = payloadOf<ScanPayload>(
      await post(SCAN, { b: member.barcode }, other),
      "recordScan",
    );
    expect(reply.member).toBeNull();
    expect(reply.errors[0]?.code).toBe("NOT_FOUND");
  });
});
