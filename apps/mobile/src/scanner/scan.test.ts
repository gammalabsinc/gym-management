import { describe, expect, it, vi } from "vitest";
import { createScanService, RECENT_VISITS, SCAN_FAILED_MESSAGE, SEARCH_LIMIT } from "./scan";

function service(outcome: unknown) {
  const client = { execute: vi.fn(async (_operation: { variables: unknown }) => outcome) };
  // biome-ignore lint/suspicious/noExplicitAny: scripted outcome
  return { svc: createScanService({ client: client as any }), client };
}

const data = (payload: unknown) => ({ status: "data", data: { recordScan: payload } });

describe("scan service", () => {
  it("sends the barcode once and maps the member", async () => {
    const s = service(
      data({
        visit: { isDuplicate: false },
        member: {
          id: "m1",
          name: "Sam",
          standing: "PAID",
          paidThrough: "2026-12-13",
          status: "ACTIVE",
          leftOn: null,
        },
        errors: [],
      }),
    );
    expect(await s.svc.record("ABC123")).toEqual({
      status: "recorded",
      memberId: "m1",
      memberName: "Sam",
      standing: "PAID",
      paidThrough: "2026-12-13",
      membership: "ACTIVE",
      leftOn: null,
      isDuplicate: false,
    });
    expect(s.client.execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(s.client.execute.mock.calls[0])).toContain("ABC123");
  });

  it("keeps null names and dates, and flags repeats", async () => {
    const s = service(
      data({
        visit: { isDuplicate: true },
        member: {
          id: "m2",
          name: null,
          standing: "INACTIVE",
          status: "CANCELLED",
          leftOn: "2026-10-30",
        },
        errors: [],
      }),
    );
    expect(await s.svc.record("x")).toMatchObject({
      memberName: null,
      paidThrough: null,
      membership: "CANCELLED",
      leftOn: "2026-10-30",
      isDuplicate: true,
    });
  });

  it("reports an unknown barcode", async () => {
    const s = service(data({ visit: null, member: null, errors: [{ code: "NOT_FOUND" }] }));
    expect(await s.svc.record("x")).toEqual({ status: "notRecognized" });
  });

  it("fails on other errors and on missing parts", async () => {
    const failed = { status: "failed", message: SCAN_FAILED_MESSAGE };
    expect(
      await service(
        data({ visit: null, member: null, errors: [{ code: "FORBIDDEN" }] }),
      ).svc.record("x"),
    ).toEqual(failed);
    expect(
      await service(
        data({ visit: null, member: { name: "a", standing: "PAID" }, errors: [] }),
      ).svc.record("x"),
    ).toEqual(failed);
    expect(
      await service(data({ visit: { isDuplicate: false }, member: null, errors: [] })).svc.record(
        "x",
      ),
    ).toEqual(failed);
    expect(await service({ status: "empty" }).svc.record("x")).toEqual(failed);
  });

  it("maps network and api errors", async () => {
    expect(await service({ status: "network", message: "offline" }).svc.record("x")).toEqual({
      status: "offline",
    });
    expect(await service({ status: "error", error: { message: "nope" } }).svc.record("x")).toEqual({
      status: "failed",
      message: "nope",
    });
  });

  it("finds the first check in behind a repeat, skipping repeats", async () => {
    const s = service({
      status: "data",
      data: {
        tenant: { timezone: "America/Toronto" },
        visits: {
          items: [
            { scannedAt: "2026-11-26T12:13:00Z", isDuplicate: true },
            { scannedAt: "2026-11-26T12:12:00Z", isDuplicate: false },
          ],
        },
      },
    });
    expect(await s.svc.firstCheckIn("m1")).toEqual({
      status: "found",
      at: "2026-11-26T12:12:00Z",
      timezone: "America/Toronto",
    });
    expect(s.client.execute.mock.calls[0]?.[0].variables).toEqual({
      visits_memberId: "m1",
      visits_page: { limit: RECENT_VISITS },
    });
  });

  it("answers unknown when there is no original visit or the lookup fails", async () => {
    const none = {
      status: "data",
      data: {
        tenant: { timezone: "UTC" },
        visits: { items: [{ scannedAt: "x", isDuplicate: true }] },
      },
    };
    expect(await service(none).svc.firstCheckIn("m1")).toEqual({ status: "unknown" });
    for (const outcome of [
      { status: "network", message: "offline" },
      { status: "error", error: { message: "nope" } },
      { status: "empty" },
    ]) {
      expect(await service(outcome).svc.firstCheckIn("m1")).toEqual({ status: "unknown" });
    }
  });
});

describe("scan service search", () => {
  const found = {
    status: "data",
    data: {
      members: {
        items: [
          {
            id: "m1",
            barcode: "ABC123",
            name: null,
            memberNo: "0042",
            status: "ACTIVE",
            standing: "OVERDUE",
          },
        ],
      },
    },
  };

  it("sends the trimmed text with a page limit and maps the rows", async () => {
    const s = service(found);
    expect(await s.svc.search("  sam ")).toEqual({
      status: "results",
      rows: [
        {
          memberId: "m1",
          barcode: "ABC123",
          name: null,
          memberNo: "0042",
          status: "ACTIVE",
          standing: "OVERDUE",
        },
      ],
    });
    const sent = JSON.stringify(s.client.execute.mock.calls[0]);
    expect(sent).toContain('"sam"');
    expect(sent).toContain(String(SEARCH_LIMIT));
  });

  it("asks nothing for blank text", async () => {
    const s = service(found);
    expect(await s.svc.search("   ")).toEqual({ status: "results", rows: [] });
    expect(s.client.execute).not.toHaveBeenCalled();
  });

  it("maps empty, network and error outcomes", async () => {
    expect(await service({ status: "empty" }).svc.search("x")).toEqual({
      status: "results",
      rows: [],
    });
    expect(await service({ status: "network", message: "Offline" }).svc.search("x")).toEqual({
      status: "failed",
      message: "Offline",
    });
    expect(await service({ status: "error", error: { message: "Nope" } }).svc.search("x")).toEqual({
      status: "failed",
      message: "Nope",
    });
  });

  it("marks a check in from the search as manual, and a scan as the staff app", async () => {
    const ok = data({ visit: null, member: null, errors: [{ code: "NOT_FOUND" }] });
    const manual = service(ok);
    await manual.svc.record("ABC123", "MANUAL");
    expect(JSON.stringify(manual.client.execute.mock.calls[0])).toContain("MANUAL");
    const scan = service(ok);
    await scan.svc.record("ABC123");
    expect(JSON.stringify(scan.client.execute.mock.calls[0])).not.toContain("MANUAL");
  });
});
