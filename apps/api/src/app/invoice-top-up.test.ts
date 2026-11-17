import { describe, expect, it } from "vitest";
import { brandingFromJson, DEFAULT_SETTINGS, type Tenant } from "../domain/tenant";
import { makeInvoiceTopUp } from "./invoice-top-up";
import type {
  AuditEvent,
  BillableMember,
  Exclusive,
  LogContext,
  LogFields,
  Logger,
  TenantJobLock,
  TopUpUnit,
} from "./ports";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TENANT_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
/** Morning of 16 November in Toronto. */
const NOW = new Date("2026-11-16T15:00:00.000Z");

interface GymWorld {
  warnDaysBefore?: number;
  members?: Record<string, Partial<BillableMember>>;
  /** Members whose invoice insert throws. */
  broken?: string[];
  /** Members on the roster whose row is gone by the time they are locked. */
  vanished?: string[];
  readFails?: boolean;
  noTenant?: boolean;
}

interface LogLine {
  level: string;
  message: string;
  context: LogContext;
  fields: LogFields;
}

function makeLogger(lines: LogLine[], context: LogContext = {}): Logger {
  const write =
    (level: string) =>
    (message: string, fields: LogFields = {}) => {
      lines.push({ level, message, context, fields });
    };
  return {
    debug: write("debug"),
    info: write("info"),
    warn: write("warn"),
    error: write("error"),
    child: (extra) => makeLogger(lines, { ...context, ...extra }),
  };
}

function member(id: string, overrides: Partial<BillableMember> = {}): BillableMember {
  return {
    id,
    billingDay: 20,
    status: "active",
    planId: "plan",
    activeFrom: "2026-10-20",
    ...overrides,
  };
}

function setup(worlds: Record<string, GymWorld>, locked: string[] = []) {
  const inserted: { tenantId: string; memberId: string; periodStart: string }[] = [];
  const audits: { tenantId: string; event: AuditEvent }[] = [];
  const lines: LogLine[] = [];
  const lockedNow = new Set(locked);
  const unitFor = (tenantId: string): TopUpUnit => {
    const world = worlds[tenantId] ?? {};
    const members = world.members ?? {};
    return {
      roster: {
        activeMemberIds: async () => {
          if (world.readFails === true) throw new Error("roster unavailable");
          return Object.keys(members);
        },
      },
      tenants: {
        find: async () =>
          world.noTenant === true
            ? null
            : ({
                id: tenantId,
                name: "Gym",
                subdomain: "gym",
                timezone: "America/Toronto",
                currency: "CAD",
                branding: brandingFromJson({}),
                settings: { ...DEFAULT_SETTINGS, warnDaysBefore: world.warnDaysBefore ?? 5 },
              } satisfies Tenant),
      },
      invoices: {
        lockMember: async (memberId) => {
          const found = world.vanished?.includes(memberId) ? undefined : members[memberId];
          return found === undefined ? null : member(memberId, found);
        },
        findPlanFees: async () => ({ admissionFee: 2000, monthlyFee: 5000 }),
        lastPeriodEnd: async () => "2026-11-19",
        discountsOf: async () => [],
        insert: async (memberId, draft) => {
          if (world.broken?.includes(memberId)) throw new Error("insert failed");
          inserted.push({ tenantId, memberId, periodStart: draft.periodStart });
          return `invoice-${inserted.length}`;
        },
        markConsumed: async () => {},
      },
      audit: {
        record: async (event) => {
          audits.push({ tenantId, event });
        },
      },
    };
  };
  const lock: TenantJobLock = {
    runExclusive: async <T>(tenantId: string, fn: () => Promise<T>): Promise<Exclusive<T>> =>
      lockedNow.has(tenantId) ? { ran: false } : { ran: true, value: await fn() },
  };
  const topUp = makeInvoiceTopUp({
    tenants: { activeTenantIds: async () => Object.keys(worlds) },
    lock,
    withUnit: async (tenantId, fn) => fn(unitFor(tenantId)),
    clock: { now: () => NOW },
    logger: makeLogger(lines),
  });
  return { topUp, inserted, audits, lines };
}

const RUN = { requestId: "run-1" };

describe("the daily invoice top up", () => {
  it("builds the next invoice of a member whose cycle starts within the gym's warning window", async () => {
    // Today is 16 November. The cycle of 20 November starts in 4 days, inside a window of 5.
    const { topUp, inserted, audits } = setup({ [TENANT_A]: { members: { [M1]: {} } } });
    const summary = await topUp(RUN);
    expect(summary).toEqual({
      tenants: 1,
      skippedTenants: 0,
      failedTenants: 0,
      invoices: 1,
      failedMembers: 0,
    });
    expect(inserted).toEqual([{ tenantId: TENANT_A, memberId: M1, periodStart: "2026-11-20" }]);
    expect(audits[0]?.event).toMatchObject({ actorUserId: null, requestId: "run-1" });
  });

  it("builds nothing when the next cycle starts after the warning window", async () => {
    const { topUp, inserted } = setup({
      [TENANT_A]: { warnDaysBefore: 3, members: { [M1]: {} } },
    });
    expect((await topUp(RUN)).invoices).toBe(0);
    expect(inserted).toEqual([]);
  });

  it("uses each gym's own warning window", async () => {
    const { topUp, inserted } = setup({
      [TENANT_A]: { warnDaysBefore: 3, members: { [M1]: {} } },
      [TENANT_B]: { warnDaysBefore: 4, members: { [M2]: {} } },
    });
    await topUp(RUN);
    expect(inserted.map((row) => row.tenantId)).toEqual([TENANT_B]);
  });

  it("gives no invoice to a member who is not active", async () => {
    const { topUp, inserted } = setup({
      [TENANT_A]: { members: { [M1]: { status: "paused" } } },
    });
    expect((await topUp(RUN)).invoices).toBe(0);
    expect(inserted).toEqual([]);
  });

  it("leaves a gym to the worker that holds its lock, and works the others", async () => {
    const { topUp, inserted, lines } = setup(
      { [TENANT_A]: { members: { [M1]: {} } }, [TENANT_B]: { members: { [M2]: {} } } },
      [TENANT_A],
    );
    const summary = await topUp(RUN);
    expect(summary).toMatchObject({ tenants: 2, skippedTenants: 1, failedTenants: 0, invoices: 1 });
    expect(inserted.map((row) => row.tenantId)).toEqual([TENANT_B]);
    expect(lines.find((line) => line.message.includes("skipped"))?.context).toMatchObject({
      tenantId: TENANT_A,
    });
  });

  it("logs a gym that fails with its id, and carries on with the gyms after it", async () => {
    const { topUp, inserted, lines } = setup({
      [TENANT_A]: { readFails: true },
      [TENANT_B]: { noTenant: true },
      [TENANT_C]: { members: { [M1]: {} } },
    });
    const summary = await topUp(RUN);
    expect(summary).toEqual({
      tenants: 3,
      skippedTenants: 0,
      failedTenants: 2,
      invoices: 1,
      failedMembers: 0,
    });
    expect(inserted.map((row) => row.tenantId)).toEqual([TENANT_C]);
    const errors = lines.filter((line) => line.level === "error");
    expect(errors.map((line) => line.context.tenantId)).toEqual([TENANT_A, TENANT_B]);
    expect(errors[0]).toMatchObject({
      message: "invoice top up failed for a gym",
      context: { requestId: "run-1" },
      fields: { reason: "roster unavailable" },
    });
    expect(errors[1]?.fields.reason).toContain("cannot be read");
  });

  it("logs a member that fails with the gym and member ids, and still builds the others", async () => {
    const { topUp, inserted, lines } = setup({
      [TENANT_A]: { broken: [M1], members: { [M1]: {}, [M2]: {} } },
      [TENANT_B]: { members: { [M1]: {} } },
    });
    const summary = await topUp(RUN);
    expect(summary).toEqual({
      tenants: 2,
      skippedTenants: 0,
      failedTenants: 1,
      invoices: 2,
      failedMembers: 1,
    });
    expect(inserted.map((row) => `${row.tenantId}:${row.memberId}`)).toEqual([
      `${TENANT_A}:${M2}`,
      `${TENANT_B}:${M1}`,
    ]);
    const error = lines.find((line) => line.level === "error");
    expect(error).toMatchObject({
      message: "invoice top up failed for a member",
      context: { tenantId: TENANT_A },
      fields: { memberId: M1, reason: "insert failed" },
    });
  });

  it("counts a member the invoice rules refuse as failed, logs why, and builds the others", async () => {
    const { topUp, inserted, lines } = setup({
      [TENANT_A]: { vanished: [M1], members: { [M1]: {}, [M2]: {} } },
    });
    const summary = await topUp(RUN);
    expect(summary).toMatchObject({ failedTenants: 1, invoices: 1, failedMembers: 1 });
    expect(inserted.map((row) => row.memberId)).toEqual([M2]);
    expect(lines.find((line) => line.level === "error")).toMatchObject({
      message: "invoice top up refused a member",
      context: { tenantId: TENANT_A },
      fields: { memberId: M1, reason: "Member not found" },
    });
  });

  it("logs the text of a failure that is not an Error", async () => {
    const { lines } = setup({});
    const throwing = makeInvoiceTopUp({
      tenants: { activeTenantIds: async () => [TENANT_A] },
      lock: {
        runExclusive: async () => {
          throw "plain text failure";
        },
      },
      withUnit: async () => {
        throw new Error("unused");
      },
      clock: { now: () => NOW },
      logger: makeLogger(lines),
    });
    expect((await throwing(RUN)).failedTenants).toBe(1);
    expect(lines.at(-1)?.fields.reason).toBe("plain text failure");
  });

  it("does nothing, and says so, when there are no gyms", async () => {
    const { topUp } = setup({});
    expect(await topUp(RUN)).toEqual({
      tenants: 0,
      skippedTenants: 0,
      failedTenants: 0,
      invoices: 0,
      failedMembers: 0,
    });
  });
});
