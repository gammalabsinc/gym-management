import { randomUUID } from "node:crypto";
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
interface MemberRow {
  id: string;
  name: string | null;
  status: string;
  standing: string;
  balanceDue: number;
  credit: number;
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

const MEMBER_FIELDS = "id name status standing balanceDue credit";

async function findMember(token: string, name: string): Promise<MemberRow> {
  const reply = await post(
    `query($s: String) { members(search: $s) { items { ${MEMBER_FIELDS} } } }`,
    { s: name },
    token,
  );
  const items = (reply.data?.members as { items: MemberRow[] } | undefined)?.items ?? [];
  const found = items.find((m) => m.name === name);
  if (found === undefined) throw new Error(`no member ${name}`);
  return found;
}

async function planId(token: string): Promise<string> {
  const reply = await post("{ plans { id } }", {}, token);
  return payloadOf<{ id: string }[]>(reply, "plans")[0]?.id ?? "";
}

const payloadOf = <T>(reply: Reply, field: string): T => {
  const payload = reply.data?.[field];
  if (payload === undefined || payload === null)
    throw new Error(`no ${field}: ${JSON.stringify(reply)}`);
  return payload as T;
};

const CREATE = `mutation($input: MemberInput!) {
  createMember(input: $input) { member { ${MEMBER_FIELDS} email memberNo plan { name } } errors { code field message } }
}`;

type CreatePayload = {
  member: (MemberRow & { email: string; memberNo: string }) | null;
  errors: UserErrorRow[];
};

describe("createMember", () => {
  it("adds a member, with the first invoice, and returns the member as staff read it", async () => {
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const plan = await planId(staff);
    const reply = await post(
      CREATE,
      {
        input: {
          name: "Nina New",
          email: "nina@ironworks.test",
          planId: plan,
          joinedOn: new Date().toISOString().slice(0, 10),
          phone: "+1 555 0100",
        },
      },
      staff,
    );
    const payload = payloadOf<CreatePayload>(reply, "createMember");
    expect(payload.errors).toEqual([]);
    expect(payload.member).toMatchObject({
      name: "Nina New",
      email: "nina@ironworks.test",
      status: "ACTIVE",
      balanceDue: 9000,
    });
    expect(payload.member?.memberNo).toMatch(/^[A-Z0-9]{6}$/);
  });

  it("names the field of an invalid value, with the schema's own field name", async () => {
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const plan = await planId(staff);
    const reply = await post(
      CREATE,
      { input: { name: "Bad Email", email: "nope", planId: plan, joinedOn: "2026-01-01" } },
      staff,
    );
    const payload = payloadOf<CreatePayload>(reply, "createMember");
    expect(payload.member).toBeNull();
    expect(payload.errors[0]).toMatchObject({ code: "INVALID_INPUT", field: "email" });
    const future = await post(
      CREATE,
      {
        input: {
          name: "Future",
          email: "future@ironworks.test",
          planId: plan,
          joinedOn: "2999-01-01",
        },
      },
      staff,
    );
    expect(payloadOf<CreatePayload>(future, "createMember").errors[0]).toMatchObject({
      code: "INVALID_INPUT",
      field: "joinedOn",
    });
  });

  it("refuses a second member row for the same person as a conflict", async () => {
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const plan = await planId(staff);
    const reply = await post(
      CREATE,
      {
        input: {
          name: "Paula Again",
          email: "paula@ironworks.test",
          planId: plan,
          joinedOn: new Date().toISOString().slice(0, 10),
        },
      },
      staff,
    );
    expect(payloadOf<CreatePayload>(reply, "createMember").errors[0]?.code).toBe("CONFLICT");
  });

  it("refuses a plan that is not the gym's, a photo and an unknown referrer", async () => {
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const plan = await planId(staff);
    const today = new Date().toISOString().slice(0, 10);
    const otherGymPlan = await planId(await sessionFor("owner@pulsefit.test", "pulsefit"));
    const wrongPlan = await post(
      CREATE,
      { input: { name: "X", email: "x1@ironworks.test", planId: otherGymPlan, joinedOn: today } },
      staff,
    );
    expect(payloadOf<CreatePayload>(wrongPlan, "createMember").errors[0]).toMatchObject({
      code: "INVALID_INPUT",
      field: "planId",
    });
    const photo = await post(
      CREATE,
      {
        input: {
          name: "X",
          email: "x2@ironworks.test",
          planId: plan,
          joinedOn: today,
          photoRef: "p.jpg",
        },
      },
      staff,
    );
    expect(payloadOf<CreatePayload>(photo, "createMember").errors[0]).toMatchObject({
      field: "photoRef",
    });
    const referrer = await post(
      CREATE,
      {
        input: {
          name: "X",
          email: "x3@ironworks.test",
          planId: plan,
          joinedOn: today,
          referredById: randomUUID(),
        },
      },
      staff,
    );
    expect(payloadOf<CreatePayload>(referrer, "createMember").errors[0]).toMatchObject({
      code: "INVALID_INPUT",
      field: "referredById",
    });
  });

  it("records a referral when the referrer is a member of the gym", async () => {
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const plan = await planId(staff);
    const referrer = await findMember(staff, "Paula Paid");
    const reply = await post(
      `mutation($input: MemberInput!) { createMember(input: $input) { member { name referredBy { name } } errors { message } } }`,
      {
        input: {
          name: "Rita Referred",
          email: "rita@ironworks.test",
          planId: plan,
          joinedOn: new Date().toISOString().slice(0, 10),
          referredById: referrer.id,
        },
      },
      staff,
    );
    expect(
      payloadOf<{ member: { referredBy: { name: string } } }>(reply, "createMember").member
        .referredBy.name,
    ).toBe("Paula Paid");
  });

  it("does not let a member add members", async () => {
    const member = await sessionFor("paula@ironworks.test", "ironworks");
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const plan = await planId(staff);
    const reply = await post(
      CREATE,
      {
        input: {
          name: "Sneaky",
          email: "sneaky@ironworks.test",
          planId: plan,
          joinedOn: new Date().toISOString().slice(0, 10),
        },
      },
      member,
    );
    expect(payloadOf<CreatePayload>(reply, "createMember").errors[0]?.code).toBe("FORBIDDEN");
  });

  it("needs a session", async () => {
    const reply = await post(CREATE, {
      input: { name: "N", email: "n@x.test", planId: randomUUID(), joinedOn: "2026-01-01" },
    });
    expect(reply.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
  });

  it("puts the new member in the gym that created it and no other", async () => {
    const pulse = await sessionFor("staff@pulsefit.test", "pulsefit");
    const found = await post(`query { members(search: "Nina") { items { id } } }`, {}, pulse);
    expect(payloadOf<{ items: unknown[] }>(found, "members").items).toEqual([]);
  });
});

const UPDATE = `mutation($id: ID!, $patch: MemberPatch!) {
  updateMember(id: $id, patch: $patch) { member { ${MEMBER_FIELDS} } errors { code field message } }
}`;
type UpdatePayload = { member: MemberRow | null; errors: UserErrorRow[] };

describe("updateMember", () => {
  it("changes the name and phone", async () => {
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const pedro = await findMember(staff, "Pedro Paid");
    const reply = await post(
      UPDATE,
      { id: pedro.id, patch: { name: "Pedro P. Paid", phone: "+1 555 0123" } },
      staff,
    );
    expect(payloadOf<UpdatePayload>(reply, "updateMember").member?.name).toBe("Pedro P. Paid");
    await post(UPDATE, { id: pedro.id, patch: { name: "Pedro Paid" } }, staff);
  });

  it("refuses an empty patch, a bad phone and a status without a reason", async () => {
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const pedro = await findMember(staff, "Pedro Paid");
    const empty = await post(UPDATE, { id: pedro.id, patch: {} }, staff);
    expect(payloadOf<UpdatePayload>(empty, "updateMember").errors[0]?.code).toBe("INVALID_INPUT");
    const phone = await post(UPDATE, { id: pedro.id, patch: { phone: "abc" } }, staff);
    expect(payloadOf<UpdatePayload>(phone, "updateMember").errors[0]).toMatchObject({
      code: "INVALID_INPUT",
      field: "phone",
    });
    const noReason = await post(UPDATE, { id: pedro.id, patch: { status: "PAUSED" } }, staff);
    expect(payloadOf<UpdatePayload>(noReason, "updateMember").errors[0]).toMatchObject({
      field: "reason",
    });
  });

  it("pauses and resumes with a reason, and only the owner cancels", async () => {
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const owner = await sessionFor("owner@ironworks.test", "ironworks");
    const dana = await findMember(staff, "Dana Due");
    const paused = await post(
      UPDATE,
      { id: dana.id, patch: { status: "PAUSED", reason: "Away" } },
      staff,
    );
    expect(payloadOf<UpdatePayload>(paused, "updateMember").member).toMatchObject({
      status: "PAUSED",
      standing: "INACTIVE",
    });
    const again = await post(
      UPDATE,
      { id: dana.id, patch: { status: "PAUSED", reason: "Away" } },
      staff,
    );
    expect(payloadOf<UpdatePayload>(again, "updateMember").errors[0]?.code).toBe("CONFLICT");
    const resumed = await post(
      UPDATE,
      { id: dana.id, patch: { status: "ACTIVE", reason: "Back" } },
      staff,
    );
    expect(payloadOf<UpdatePayload>(resumed, "updateMember").member?.status).toBe("ACTIVE");
    const staffCancel = await post(
      UPDATE,
      { id: dana.id, patch: { status: "CANCELLED", reason: "Left" } },
      staff,
    );
    expect(payloadOf<UpdatePayload>(staffCancel, "updateMember").errors[0]?.code).toBe("FORBIDDEN");
    const ownerCancel = await post(
      UPDATE,
      { id: dana.id, patch: { status: "CANCELLED", reason: "Left" } },
      owner,
    );
    expect(payloadOf<UpdatePayload>(ownerCancel, "updateMember").member?.status).toBe("CANCELLED");
  });

  it("changes a name and a status in one call", async () => {
    const owner = await sessionFor("owner@ironworks.test", "ironworks");
    const pedro = await findMember(owner, "Pedro Paid");
    const reply = await post(
      UPDATE,
      { id: pedro.id, patch: { name: "Pedro Both", status: "PAUSED", reason: "Trip" } },
      owner,
    );
    expect(payloadOf<UpdatePayload>(reply, "updateMember").member).toMatchObject({
      name: "Pedro Both",
      status: "PAUSED",
    });
  });

  it("is not found for an unknown member and for another gym's member", async () => {
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const olga = await findMember(staff, "Olga Overdue");
    const pulse = await sessionFor("staff@pulsefit.test", "pulsefit");
    const cross = await post(UPDATE, { id: olga.id, patch: { name: "Hijacked" } }, pulse);
    expect(payloadOf<UpdatePayload>(cross, "updateMember").errors[0]?.code).toBe("NOT_FOUND");
    const unknown = await post(UPDATE, { id: randomUUID(), patch: { name: "Nobody" } }, staff);
    expect(payloadOf<UpdatePayload>(unknown, "updateMember").errors[0]?.code).toBe("NOT_FOUND");
    expect((await findMember(staff, "Olga Overdue")).name).toBe("Olga Overdue");
  });

  it("refuses a field that may not change, like the email", async () => {
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const olga = await findMember(staff, "Olga Overdue");
    const reply = await post(UPDATE, { id: olga.id, patch: { email: "x@y.test" } }, staff);
    expect(reply.errors).toBeDefined();
  });

  it("does not let a member edit anyone", async () => {
    const member = await sessionFor("paula@ironworks.test", "ironworks");
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const olga = await findMember(staff, "Olga Overdue");
    const reply = await post(UPDATE, { id: olga.id, patch: { name: "Nope" } }, member);
    expect(payloadOf<UpdatePayload>(reply, "updateMember").errors[0]?.code).toBe("FORBIDDEN");
  });
});

const RECORD = `mutation($input: RecordPaymentInput!) {
  recordPayment(input: $input) { payment { id amount method isVoid allocations { invoiceId amount } } member { ${MEMBER_FIELDS} } errors { code field message } }
}`;
type RecordPayload = {
  payment: {
    id: string;
    amount: number;
    method: string;
    isVoid: boolean;
    allocations: { invoiceId: string; amount: number }[];
  } | null;
  member: MemberRow | null;
  errors: UserErrorRow[];
};

describe("recordPayment", () => {
  it("settles the overdue invoice, returns the member as paid, and is safe to retry", async () => {
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const olga = await findMember(staff, "Olga Overdue");
    const input = {
      clientRequestId: randomUUID(),
      memberId: olga.id,
      amount: 9000,
      method: "CASH",
    };
    const first = payloadOf<RecordPayload>(await post(RECORD, { input }, staff), "recordPayment");
    expect(first.errors).toEqual([]);
    expect(first.payment).toMatchObject({ amount: 9000, method: "CASH", isVoid: false });
    expect(first.payment?.allocations).toHaveLength(1);
    expect(first.member).toMatchObject({ standing: "PAID", balanceDue: 0, credit: 0 });
    const retry = payloadOf<RecordPayload>(await post(RECORD, { input }, staff), "recordPayment");
    expect(retry.payment?.id).toBe(first.payment?.id);
    const { rows } = await db.admin.query(
      "SELECT count(*)::int AS n FROM payments WHERE member_id = $1",
      [olga.id],
    );
    expect((rows[0] as { n: number }).n).toBe(1);
  });

  it("refuses a bad amount and a reused request id for another member", async () => {
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const pedro = await findMember(staff, "Pedro Both");
    const bad = await post(
      RECORD,
      { input: { clientRequestId: randomUUID(), memberId: pedro.id, amount: 0, method: "CASH" } },
      staff,
    );
    expect(payloadOf<RecordPayload>(bad, "recordPayment").errors[0]).toMatchObject({
      code: "INVALID_INPUT",
      field: "amount",
    });
    const paula = await findMember(staff, "Paula Paid");
    const reused = randomUUID();
    await post(
      RECORD,
      { input: { clientRequestId: reused, memberId: paula.id, amount: 100, method: "CARD" } },
      staff,
    );
    const clash = await post(
      RECORD,
      { input: { clientRequestId: reused, memberId: pedro.id, amount: 100, method: "CARD" } },
      staff,
    );
    expect(payloadOf<RecordPayload>(clash, "recordPayment").errors[0]?.code).toBe("CONFLICT");
  });

  it("is not found for another gym's member", async () => {
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const paula = await findMember(staff, "Paula Paid");
    const pulse = await sessionFor("staff@pulsefit.test", "pulsefit");
    const reply = await post(
      RECORD,
      { input: { clientRequestId: randomUUID(), memberId: paula.id, amount: 500, method: "CASH" } },
      pulse,
    );
    expect(payloadOf<RecordPayload>(reply, "recordPayment").errors[0]?.code).toBe("NOT_FOUND");
  });

  it("does not let a member record payments", async () => {
    const member = await sessionFor("paula@ironworks.test", "ironworks");
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const paula = await findMember(staff, "Paula Paid");
    const reply = await post(
      RECORD,
      { input: { clientRequestId: randomUUID(), memberId: paula.id, amount: 500, method: "CASH" } },
      member,
    );
    expect(payloadOf<RecordPayload>(reply, "recordPayment").errors[0]?.code).toBe("FORBIDDEN");
  });
});

const VOID_PAYMENT = `mutation($id: ID!, $reason: String!) {
  voidPayment(id: $id, reason: $reason) { payment { id isVoid voidReason } member { ${MEMBER_FIELDS} } errors { code message } }
}`;
const VOID_INVOICE = `mutation($id: ID!, $reason: String!) {
  voidInvoice(id: $id, reason: $reason) { invoice { id isVoid voidReason } errors { code message } }
}`;

async function invoiceIds(token: string, memberId: string): Promise<string[]> {
  const reply = await post(
    "query($id: ID!) { invoices(memberId: $id) { items { id } } }",
    { id: memberId },
    token,
  );
  return payloadOf<{ items: { id: string }[] }>(reply, "invoices").items.map((i) => i.id);
}

async function lastPaymentId(token: string, memberId: string): Promise<string> {
  const reply = await post(
    "query($id: ID!) { payments(memberId: $id) { items { id } } }",
    { id: memberId },
    token,
  );
  return payloadOf<{ items: { id: string }[] }>(reply, "payments").items[0]?.id ?? "";
}

describe("voiding", () => {
  it("lets only the owner void a payment, then the invoice is owed again, and once only", async () => {
    const staff = await sessionFor("staff@ironworks.test", "ironworks");
    const owner = await sessionFor("owner@ironworks.test", "ironworks");
    const olga = await findMember(owner, "Olga Overdue");
    const paymentId = await lastPaymentId(owner, olga.id);
    const denied = await post(VOID_PAYMENT, { id: paymentId, reason: "Mistake" }, staff);
    expect(payloadOf<{ errors: UserErrorRow[] }>(denied, "voidPayment").errors[0]?.code).toBe(
      "FORBIDDEN",
    );
    const voided = payloadOf<{
      payment: { isVoid: boolean; voidReason: string };
      member: MemberRow;
      errors: UserErrorRow[];
    }>(await post(VOID_PAYMENT, { id: paymentId, reason: "Mistake" }, owner), "voidPayment");
    expect(voided.errors).toEqual([]);
    expect(voided.payment).toMatchObject({ isVoid: true, voidReason: "Mistake" });
    expect(voided.member).toMatchObject({ standing: "OVERDUE", balanceDue: 9000 });
    const twice = await post(VOID_PAYMENT, { id: paymentId, reason: "Mistake" }, owner);
    expect(payloadOf<{ errors: UserErrorRow[] }>(twice, "voidPayment").errors[0]?.code).toBe(
      "ALREADY_VOID",
    );
  });

  it("refuses to void an invoice that has payments, and voids one that has none", async () => {
    const owner = await sessionFor("owner@ironworks.test", "ironworks");
    const paula = await findMember(owner, "Paula Paid");
    const [paidInvoice] = await invoiceIds(owner, paula.id);
    const blocked = await post(VOID_INVOICE, { id: paidInvoice, reason: "Wrong" }, owner);
    expect(payloadOf<{ errors: UserErrorRow[] }>(blocked, "voidInvoice").errors[0]?.code).toBe(
      "HAS_ALLOCATIONS",
    );
    const olga = await findMember(owner, "Olga Overdue");
    const [openInvoice] = await invoiceIds(owner, olga.id);
    const voided = payloadOf<{
      invoice: { isVoid: boolean; voidReason: string };
      errors: UserErrorRow[];
    }>(await post(VOID_INVOICE, { id: openInvoice, reason: "Waived" }, owner), "voidInvoice");
    expect(voided.errors).toEqual([]);
    expect(voided.invoice).toMatchObject({ isVoid: true, voidReason: "Waived" });
    const twice = await post(VOID_INVOICE, { id: openInvoice, reason: "Waived" }, owner);
    expect(payloadOf<{ errors: UserErrorRow[] }>(twice, "voidInvoice").errors[0]?.code).toBe(
      "ALREADY_VOID",
    );
  });

  it("does not void across gyms, and refuses an empty reason", async () => {
    const owner = await sessionFor("owner@ironworks.test", "ironworks");
    const paula = await findMember(owner, "Paula Paid");
    const paymentId = await lastPaymentId(owner, paula.id);
    const [invoiceId] = await invoiceIds(owner, paula.id);
    const pulseOwner = await sessionFor("owner@pulsefit.test", "pulsefit");
    const payment = await post(VOID_PAYMENT, { id: paymentId, reason: "x" }, pulseOwner);
    expect(payloadOf<{ errors: UserErrorRow[] }>(payment, "voidPayment").errors[0]?.code).toBe(
      "NOT_FOUND",
    );
    const invoice = await post(VOID_INVOICE, { id: invoiceId, reason: "x" }, pulseOwner);
    expect(payloadOf<{ errors: UserErrorRow[] }>(invoice, "voidInvoice").errors[0]?.code).toBe(
      "NOT_FOUND",
    );
    const blank = await post(VOID_PAYMENT, { id: paymentId, reason: "   " }, owner);
    expect(payloadOf<{ errors: UserErrorRow[] }>(blank, "voidPayment").errors[0]?.code).toBe(
      "INVALID_INPUT",
    );
  });
});
