import { describe, expect, it } from "vitest";
import type { MemberView } from "../domain/member-view";
import type { Standing } from "../domain/standing";
import { brandingFromJson, DEFAULT_SETTINGS, type Tenant } from "../domain/tenant";
import type { NewAttendanceRow, ScanMember, ScanUnit } from "./ports";
import { makeRecordScan, type RecordScanContext } from "./record-scan";

const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
/** Seven twelve in the morning in Toronto. */
const NOW = new Date("2026-11-16T12:12:00.000Z");
const CLOCK = { now: () => NOW };
const FIRST = "2026-11-16T12:05:00.000000Z";

const CTX: RecordScanContext = { roles: ["staff"], tenantId: TENANT_ID };

const TENANT: Tenant = {
  id: TENANT_ID,
  name: "Gym",
  subdomain: "gym",
  timezone: "America/Toronto",
  currency: "CAD",
  branding: brandingFromJson({}),
  settings: { ...DEFAULT_SETTINGS, dupWindowMin: 10 },
};

const ACTIVE: ScanMember = { id: MEMBER_ID, status: "active", statusSince: "2026-10-01" };

function view(overrides: Partial<MemberView> = {}): MemberView {
  return {
    id: MEMBER_ID,
    memberNo: "GYM-1",
    barcode: "K7M2QX",
    name: "Ada Lovelace",
    email: "ada@example.test",
    phone: null,
    photoRef: null,
    status: "active",
    plan: {
      id: "p",
      key: "default",
      name: "Default",
      admissionFee: 0,
      monthlyFee: 0,
      isActive: true,
    },
    joinedOn: "2026-10-01",
    leftOn: null,
    billingDay: 1,
    referredBy: null,
    paidThrough: "2026-11-30",
    standing: "paid",
    balanceDue: 0,
    credit: 0,
    visitsThisMonth: 0,
    visitsLastMonth: 0,
    totalPaid: 0,
    ...overrides,
  };
}

interface World {
  member?: ScanMember | null;
  view?: MemberView | null;
  tenant?: Tenant | null;
  originalScan?: string | null;
}

function setup(world: World = {}) {
  const inserted: NewAttendanceRow[] = [];
  const windows: { now: Date; windowMinutes: number }[] = [];
  const locked: string[] = [];
  const unit: ScanUnit = {
    scans: {
      lockByBarcode: async (barcode) => {
        locked.push(barcode);
        return world.member === undefined ? ACTIVE : world.member;
      },
      originalScanWithin: async (_memberId, now, windowMinutes) => {
        windows.push({ now, windowMinutes });
        return world.originalScan ?? null;
      },
      insert: async (row) => {
        inserted.push(row);
        return "scan-1";
      },
    },
    members: { find: async () => (world.view === undefined ? view() : world.view) },
    tenants: { find: async () => (world.tenant === undefined ? TENANT : world.tenant) },
  };
  const scan = makeRecordScan({ withUnit: (_tenantId, fn) => fn(unit), clock: CLOCK });
  return { scan, inserted, windows, locked };
}

describe("makeRecordScan", () => {
  it("stores the scan and returns what the result card shows", async () => {
    const { scan, inserted, windows, locked } = setup();
    const result = await scan({ barcode: " K7M2QX " }, CTX);
    expect(result).toEqual({
      ok: true,
      value: {
        found: true,
        visit: {
          id: "scan-1",
          memberId: MEMBER_ID,
          scannedAt: "2026-11-16T12:12:00.000Z",
          localDate: "2026-11-16",
          isDuplicate: false,
          statusAtScan: "paid",
          source: "staff_app",
        },
        member: {
          id: MEMBER_ID,
          name: "Ada Lovelace",
          standing: "paid",
          paidThrough: "2026-11-30",
          status: "active",
          statusChangedOn: null,
        },
        firstCheckInAt: null,
      },
    });
    expect(locked).toEqual(["K7M2QX"]);
    expect(inserted).toEqual([
      {
        memberId: MEMBER_ID,
        scannedAt: NOW,
        localDate: "2026-11-16",
        isDuplicate: false,
        statusAtScan: "paid",
        source: "staff_app",
      },
    ]);
    expect(windows).toEqual([{ now: NOW, windowMinutes: 10 }]);
  });

  it("uses the gym's date and not the UTC date for the scan day", async () => {
    const late = new Date("2026-11-17T02:30:00.000Z");
    const unit = setup();
    const scan = makeRecordScan({
      withUnit: (_t, fn) =>
        fn({
          scans: {
            lockByBarcode: async () => ACTIVE,
            originalScanWithin: async () => null,
            insert: async (row) => {
              unit.inserted.push(row);
              return "scan-2";
            },
          },
          members: { find: async () => view() },
          tenants: { find: async () => TENANT },
        }),
      clock: { now: () => late },
    });
    await scan({ barcode: "K7M2QX" }, CTX);
    expect(unit.inserted[0]?.localDate).toBe("2026-11-16");
  });

  it("marks a repeat inside the window as a duplicate and reports the first check in", async () => {
    const { scan, inserted } = setup({ originalScan: FIRST });
    const result = await scan({ barcode: "K7M2QX" }, CTX);
    expect(result.ok && result.value.found && result.value.visit.isDuplicate).toBe(true);
    expect(result.ok && result.value.found && result.value.firstCheckInAt).toBe(FIRST);
    expect(inserted[0]?.isDuplicate).toBe(true);
  });

  it.each<Standing>(["paid", "due_soon", "overdue", "inactive"])(
    "never refuses a scan for standing %s and snapshots it",
    async (standing) => {
      const { scan, inserted } = setup({ view: view({ standing }) });
      const result = await scan({ barcode: "K7M2QX" }, CTX);
      expect(result.ok && result.value.found).toBe(true);
      expect(inserted[0]?.statusAtScan).toBe(standing);
    },
  );

  it("leaves paid through empty for a new member who has not paid", async () => {
    const { scan } = setup({ view: view({ paidThrough: null }) });
    const result = await scan({ barcode: "K7M2QX" }, CTX);
    expect(result.ok && result.value.found && result.value.member.paidThrough).toBeNull();
  });

  it.each(["paused", "cancelled"] as const)(
    "reports the date a %s membership began",
    async (status) => {
      const { scan } = setup({
        member: { id: MEMBER_ID, status, statusSince: "2026-11-02" },
        view: view({ standing: "inactive" }),
      });
      const result = await scan({ barcode: "K7M2QX", source: "manual" }, CTX);
      expect(result.ok && result.value.found && result.value.member).toMatchObject({
        status,
        statusChangedOn: "2026-11-02",
      });
      expect(result.ok && result.value.found && result.value.visit.source).toBe("manual");
    },
  );

  it("answers a code nobody holds with the unknown code result and writes nothing", async () => {
    const { scan, inserted } = setup({ member: null });
    expect(await scan({ barcode: "ZZZZZZ" }, CTX)).toEqual({ ok: true, value: { found: false } });
    expect(inserted).toEqual([]);
  });

  it("refuses invalid input before opening a transaction", async () => {
    const { scan, locked } = setup();
    const result = await scan({ barcode: "  " }, CTX);
    expect(result.ok).toBe(false);
    expect(locked).toEqual([]);
  });

  it("refuses a caller without the scan permission", async () => {
    const { scan, locked } = setup();
    const result = await scan({ barcode: "K7M2QX" }, { ...CTX, roles: ["member"] });
    expect(result).toMatchObject({ ok: false, error: { kind: "forbidden" } });
    expect(locked).toEqual([]);
  });

  it("is guarded by the scan permission", () => {
    expect(setup().scan.requiredPermission).toBe("scan.record");
  });

  it("throws when the gym row cannot be read, since that is a bug", async () => {
    const { scan } = setup({ tenant: null });
    await expect(scan({ barcode: "K7M2QX" }, CTX)).rejects.toThrow("cannot be read");
  });

  it("throws when a locked member cannot be read, since that is a bug", async () => {
    const { scan } = setup({ view: null });
    await expect(scan({ barcode: "K7M2QX" }, CTX)).rejects.toThrow("cannot be read");
  });
});
