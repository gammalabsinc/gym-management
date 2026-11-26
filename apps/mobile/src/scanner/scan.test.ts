import { describe, expect, it, vi } from "vitest";
import { createScanService, SCAN_FAILED_MESSAGE } from "./scan";

function service(outcome: unknown) {
  const client = { execute: vi.fn(async () => outcome) };
  // biome-ignore lint/suspicious/noExplicitAny: scripted outcome
  return { svc: createScanService({ client: client as any }), client };
}

const data = (payload: unknown) => ({ status: "data", data: { recordScan: payload } });

describe("scan service", () => {
  it("sends the barcode once and maps the member", async () => {
    const s = service(
      data({
        visit: { isDuplicate: false },
        member: { name: "Sam", standing: "PAID", paidThrough: "2026-12-13" },
        errors: [],
      }),
    );
    expect(await s.svc.record("ABC123")).toEqual({
      status: "recorded",
      memberName: "Sam",
      standing: "PAID",
      paidThrough: "2026-12-13",
      isDuplicate: false,
    });
    expect(s.client.execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(s.client.execute.mock.calls[0])).toContain("ABC123");
  });

  it("keeps null names and dates, and flags repeats", async () => {
    const s = service(
      data({
        visit: { isDuplicate: true },
        member: { name: null, standing: "OVERDUE", paidThrough: null },
        errors: [],
      }),
    );
    expect(await s.svc.record("x")).toMatchObject({
      memberName: null,
      paidThrough: null,
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
});
