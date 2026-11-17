import { describe, expect, it } from "vitest";
import type { MembershipStatus } from "../domain/standing";
import { brandingFromJson, DEFAULT_SETTINGS, type Tenant } from "../domain/tenant";
import {
  type ChangeMembershipContext,
  makeCancelMember,
  makePauseMember,
  makeResumeMember,
} from "./change-membership";
import type { AuditEvent, CurrentPeriod, MembershipUnit, NextPeriod } from "./ports";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const MEMBER_ID = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-11-16T15:00:00.000Z");
const CLOCK = { now: () => NOW };

const CTX: ChangeMembershipContext = {
  roles: ["owner"],
  tenantId: TENANT_ID,
  userId: ACTOR_ID,
  requestId: "req-1",
};

const TENANT: Tenant = {
  id: TENANT_ID,
  name: "Gym",
  subdomain: "gym",
  timezone: "America/Toronto",
  currency: "CAD",
  branding: brandingFromJson({}),
  settings: DEFAULT_SETTINGS,
};

interface Options {
  tenant?: Tenant | null;
  current?: CurrentPeriod | null;
}

function period(status: MembershipStatus, validFrom = "2026-11-01"): CurrentPeriod {
  return { id: "period-1", planId: "plan-1", status, validFrom };
}

function harness(options: Options = {}) {
  const closed: { id: string; validTo: string }[] = [];
  const opened: NextPeriod[] = [];
  const audit: AuditEvent[] = [];
  const current = options.current === undefined ? period("active") : options.current;
  const unit: MembershipUnit = {
    periods: {
      lockCurrent: async () => current,
      close: async (id, validTo) => {
        closed.push({ id, validTo });
      },
      open: async (next) => {
        opened.push(next);
      },
    },
    tenants: { find: async () => (options.tenant === undefined ? TENANT : options.tenant) },
    audit: {
      record: async (event) => {
        audit.push(event);
      },
    },
  };
  const deps = {
    withUnit: async <T>(_t: string, fn: (u: MembershipUnit) => Promise<T>) => fn(unit),
    clock: CLOCK,
  };
  return { deps, closed, opened, audit };
}

const INPUT = { memberId: MEMBER_ID, reason: "  Travelling  " };

describe("pausing a membership", () => {
  it("closes the active period, opens a paused one and writes the audit event", async () => {
    const h = harness();
    const result = await makePauseMember(h.deps)(INPUT, { ...CTX, roles: ["staff"] });
    expect(result).toEqual({
      ok: true,
      value: { memberId: MEMBER_ID, status: "paused", effectiveFrom: "2026-11-16" },
    });
    expect(h.closed).toEqual([{ id: "period-1", validTo: "2026-11-16" }]);
    expect(h.opened).toEqual([
      {
        memberId: MEMBER_ID,
        planId: "plan-1",
        status: "paused",
        validFrom: "2026-11-16",
        reason: "Travelling",
        changedBy: ACTOR_ID,
      },
    ]);
    expect(h.audit).toEqual([
      {
        actorUserId: ACTOR_ID,
        action: "member.paused",
        entityType: "member",
        entityId: MEMBER_ID,
        before: { status: "active", validFrom: "2026-11-01" },
        after: { status: "paused", validFrom: "2026-11-16", reason: "Travelling" },
        requestId: "req-1",
      },
    ]);
  });

  it("refuses a membership that is already paused", async () => {
    const h = harness({ current: period("paused") });
    const result = await makePauseMember(h.deps)(INPUT, CTX);
    expect(result).toEqual({
      ok: false,
      error: { kind: "conflict", message: "A paused membership cannot be paused" },
    });
    expect(h.closed).toEqual([]);
    expect(h.opened).toEqual([]);
    expect(h.audit).toEqual([]);
  });

  it("dates the change by the gym's calendar, never before the period began", async () => {
    const h = harness({ current: period("active", "2026-11-20") });
    const result = await makePauseMember(h.deps)(INPUT, CTX);
    expect(result.ok && result.value.effectiveFrom).toBe("2026-11-20");
  });
});

describe("resuming a membership", () => {
  it("opens an active period after a paused one", async () => {
    const h = harness({ current: period("paused") });
    const result = await makeResumeMember(h.deps)(INPUT, { ...CTX, roles: ["staff"] });
    expect(result.ok && result.value.status).toBe("active");
    expect(h.audit[0]?.action).toBe("member.resumed");
  });

  it("refuses an active membership", async () => {
    const result = await makeResumeMember(harness().deps)(INPUT, CTX);
    expect(!result.ok && result.error.kind).toBe("conflict");
  });
});

describe("cancelling a membership", () => {
  it("cancels an active or a paused membership", async () => {
    for (const status of ["active", "paused"] as const) {
      const h = harness({ current: period(status) });
      const result = await makeCancelMember(h.deps)(INPUT, CTX);
      expect(result.ok && result.value.status).toBe("cancelled");
      expect(h.audit[0]?.action).toBe("member.cancelled");
    }
  });

  it("is for the owner only", async () => {
    const h = harness();
    const result = await makeCancelMember(h.deps)(INPUT, { ...CTX, roles: ["staff"] });
    expect(!result.ok && result.error.kind).toBe("forbidden");
    expect(h.closed).toEqual([]);
  });

  it("refuses a membership that is already cancelled", async () => {
    const result = await makeCancelMember(harness({ current: period("cancelled") }).deps)(
      INPUT,
      CTX,
    );
    expect(!result.ok && result.error.kind).toBe("conflict");
  });
});

describe("input and lookup problems", () => {
  it("requires a reason", async () => {
    const result = await makePauseMember(harness().deps)({ memberId: MEMBER_ID, reason: " " }, CTX);
    expect(!result.ok && result.error.kind).toBe("validation");
  });

  it("rejects a member id that is not a uuid", async () => {
    const result = await makePauseMember(harness().deps)({ memberId: "nope", reason: "x" }, CTX);
    expect(!result.ok && result.error.kind).toBe("validation");
  });

  it("returns not found for a member of no gym here", async () => {
    const result = await makePauseMember(harness({ current: null }).deps)(INPUT, CTX);
    expect(!result.ok && result.error.kind).toBe("not_found");
  });

  it("throws when the gym row cannot be read, which rolls the change back", async () => {
    await expect(makePauseMember(harness({ tenant: null }).deps)(INPUT, CTX)).rejects.toThrow(
      "The gym of this transaction cannot be read",
    );
  });
});
