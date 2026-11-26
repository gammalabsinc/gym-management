import { describe, expect, it, vi } from "vitest";
import { createSessionStore } from "./auth/session-store";
import { createGyms, highestRole, SELECT_FAILED_MESSAGE } from "./gyms";

function setup(outcomes: unknown[]) {
  const store = createSessionStore();
  store.signInIdentity("tok");
  const queue = [...outcomes];
  const client = { execute: vi.fn(async () => queue.shift() ?? { status: "empty" }) };
  // biome-ignore lint/suspicious/noExplicitAny: the fake client answers with scripted outcomes
  const gyms = createGyms({ client: client as any, store });
  return { gyms, store, client };
}

const list = (...gyms: { tenantId: string; name: string; roles: string[] }[]) => ({
  status: "data",
  data: { myGyms: gyms },
});
const selected = (roles: string[] | null, id: string | null = "t1", errors: unknown[] = []) => ({
  status: "data",
  data: {
    selectGym: {
      me: roles === null ? null : { roles },
      tenant: id === null ? null : { id },
      errors,
    },
  },
});

describe("highestRole", () => {
  it("picks owner over staff over member, in any case", () => {
    expect(highestRole(["MEMBER", "STAFF"])).toBe("staff");
    expect(highestRole(["member", "OWNER", "STAFF"])).toBe("owner");
    expect(highestRole(["MEMBER"])).toBe("member");
    expect(highestRole([])).toBeNull();
  });
});

describe("list", () => {
  it("maps gyms and roles", async () => {
    const s = setup([list({ tenantId: "a", name: "A", roles: ["STAFF", "MEMBER"] })]);
    expect(await s.gyms.list()).toEqual({
      status: "gyms",
      gyms: [{ tenantId: "a", name: "A", roles: ["staff", "member"] }],
    });
  });

  it("reports none, network and api errors", async () => {
    expect(await setup([{ status: "empty" }]).gyms.list()).toEqual({ status: "none" });
    expect(await setup([{ status: "network", message: "offline" }]).gyms.list()).toEqual({
      status: "failed",
      message: "offline",
    });
    expect(await setup([{ status: "error", error: { message: "bad" } }]).gyms.list()).toEqual({
      status: "failed",
      message: "bad",
    });
  });
});

describe("select", () => {
  it("enters with the role and gym the server confirmed", async () => {
    const s = setup([selected(["MEMBER", "OWNER"], "confirmed")]);
    expect(await s.gyms.select("asked")).toEqual({ status: "entered" });
    expect(s.store.getSession()).toEqual({ status: "signedIn", role: "owner" });
    expect(s.store.getTenantId()).toBe("confirmed");
  });

  it("stays on the picker when the server refuses", async () => {
    const cases: [unknown, string][] = [
      [{ status: "network", message: "offline" }, "offline"],
      [{ status: "error", error: { message: "nope" } }, "nope"],
      [{ status: "empty" }, SELECT_FAILED_MESSAGE],
      [selected(["OWNER"], "t1", [{ code: "NOT_FOUND" }]), SELECT_FAILED_MESSAGE],
      [selected(null), SELECT_FAILED_MESSAGE],
      [selected([]), SELECT_FAILED_MESSAGE],
      [selected(["OWNER"], null), SELECT_FAILED_MESSAGE],
    ];
    for (const [outcome, message] of cases) {
      const s = setup([outcome]);
      expect(await s.gyms.select("t1")).toEqual({ status: "failed", message });
      expect(s.store.getSession()).toEqual({ status: "identity" });
    }
  });

  it("treats a missing me as a refusal", async () => {
    const s = setup([{ status: "data", data: { selectGym: { tenant: { id: "t" }, errors: [] } } }]);
    expect((await s.gyms.select("t")).status).toBe("failed");
  });
});

describe("recheck", () => {
  function inGym(outcomes: unknown[]) {
    const s = setup(outcomes);
    s.store.enterGym("staff", "t1");
    return s;
  }

  it("does nothing before a gym is chosen", async () => {
    const s = setup([]);
    await s.gyms.recheck();
    expect(s.client.execute).not.toHaveBeenCalled();
  });

  it("returns to the picker when the gym is gone or has no roles", async () => {
    const gone = inGym([list({ tenantId: "t2", name: "B", roles: ["OWNER"] })]);
    await gone.gyms.recheck();
    expect(gone.store.getSession().status).toBe("identity");
    const none = inGym([{ status: "empty" }]);
    await none.gyms.recheck();
    expect(none.store.getSession().status).toBe("identity");
    const noRoles = inGym([list({ tenantId: "t1", name: "A", roles: [] })]);
    await noRoles.gyms.recheck();
    expect(noRoles.store.getSession().status).toBe("identity");
  });

  it("follows a role change", async () => {
    const s = inGym([list({ tenantId: "t1", name: "A", roles: ["MEMBER"] })]);
    await s.gyms.recheck();
    expect(s.store.getSession()).toEqual({ status: "signedIn", role: "member" });
  });

  it("keeps the session when the check itself fails", async () => {
    const s = inGym([{ status: "network", message: "offline" }]);
    await s.gyms.recheck();
    expect(s.store.getSession()).toEqual({ status: "signedIn", role: "staff" });
  });

  it("runs one check at a time", async () => {
    const s = inGym([list({ tenantId: "t1", name: "A", roles: ["STAFF"] })]);
    await Promise.all([s.gyms.recheck(), s.gyms.recheck()]);
    expect(s.client.execute).toHaveBeenCalledTimes(1);
  });
});
