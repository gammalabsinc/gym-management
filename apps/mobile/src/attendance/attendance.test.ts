import { describe, expect, it, vi } from "vitest";
import {
  ATTENDANCE_MISSING_MESSAGE,
  createAttendanceService,
  VISITS_PAGE_SIZE,
} from "./attendance";

function scripted(...outcomes: unknown[]) {
  const execute = vi.fn();
  for (const outcome of outcomes) execute.mockResolvedValueOnce(outcome);
  // biome-ignore lint/suspicious/noExplicitAny: scripted outcomes
  return { service: createAttendanceService({ client: { execute } as any }), execute };
}

const identity = (memberId: string | null | undefined = "m1") => ({
  status: "data",
  data: { me: { memberId }, tenant: { timezone: "America/Toronto" } },
});

/** `me` without a memberId at all, as the client leaves out a field the API sent as null. */
const identityWithoutMemberId = () => ({
  status: "data",
  data: { me: {}, tenant: { timezone: "America/Toronto" } },
});

const visit = (id: string, localDate: string) => ({
  id,
  localDate,
  scannedAt: `${localDate}T15:00:00Z`,
});

const firstPage = (
  over: { member?: unknown; items?: unknown[]; nextCursor?: string | null } = {},
) => ({
  status: "data",
  data: {
    member: "member" in over ? over.member : { visitsThisMonth: 4, visitsLastMonth: 9 },
    visits: {
      items: over.items ?? [visit("v1", "2026-11-20")],
      nextCursor: over.nextCursor ?? null,
    },
  },
});

describe("attendance service, first page", () => {
  it("returns the counts, the gym time zone and the newest visits", async () => {
    const { service, execute } = scripted(
      identity(),
      firstPage({
        items: [visit("v2", "2026-11-21"), visit("v1", "2026-10-30")],
        nextCursor: "c1",
      }),
    );
    expect(await service.first()).toEqual({
      status: "ready",
      memberId: "m1",
      timezone: "America/Toronto",
      visitsThisMonth: 4,
      visitsLastMonth: 9,
      items: [
        { id: "v2", localDate: "2026-11-21", scannedAt: "2026-11-21T15:00:00Z" },
        { id: "v1", localDate: "2026-10-30", scannedAt: "2026-10-30T15:00:00Z" },
      ],
      nextCursor: "c1",
    });
    const second = execute.mock.calls[1]?.[0];
    expect(second.variables).toMatchObject({
      member_id: "m1",
      visits_memberId: "m1",
      visits_page: { limit: VISITS_PAGE_SIZE },
    });
  });

  it("treats a missing cursor as the last page", async () => {
    const { service } = scripted(identity(), firstPage({ nextCursor: null }));
    expect(await service.first()).toMatchObject({ status: "ready", nextCursor: null });
  });

  it("reports a network failure of either request", async () => {
    const down = { status: "network", message: "offline" };
    expect(await scripted(down).service.first()).toEqual({ status: "failed", message: "offline" });
    expect(await scripted(identity(), down).service.first()).toEqual({
      status: "failed",
      message: "offline",
    });
  });

  it("reports an API error of either request", async () => {
    const error = { status: "error", error: { message: "Nope" } };
    expect(await scripted(error).service.first()).toEqual({ status: "failed", message: "Nope" });
    expect(await scripted(identity(), error).service.first()).toEqual({
      status: "failed",
      message: "Nope",
    });
  });

  it("fails when the account has no member record", async () => {
    const missing = { status: "failed", message: ATTENDANCE_MISSING_MESSAGE };
    expect(await scripted({ status: "empty" }).service.first()).toEqual(missing);
    expect(await scripted(identity(null)).service.first()).toEqual(missing);
    expect(await scripted(identityWithoutMemberId()).service.first()).toEqual(missing);
    expect(await scripted(identity(), { status: "empty" }).service.first()).toEqual(missing);
    expect(await scripted(identity(), firstPage({ member: null })).service.first()).toEqual(
      missing,
    );
    expect(await scripted(identity(), firstPage({ member: undefined })).service.first()).toEqual(
      missing,
    );
  });
});

describe("attendance service, older visits", () => {
  it("sends the cursor and returns the next page", async () => {
    const { service, execute } = scripted({
      status: "data",
      data: { visits: { items: [visit("v0", "2026-09-30")], nextCursor: "c2" } },
    });
    expect(await service.more("m1", "c1")).toEqual({
      status: "page",
      items: [{ id: "v0", localDate: "2026-09-30", scannedAt: "2026-09-30T15:00:00Z" }],
      nextCursor: "c2",
    });
    expect(execute.mock.calls[0]?.[0].variables).toEqual({
      visits_memberId: "m1",
      visits_page: { limit: VISITS_PAGE_SIZE, cursor: "c1" },
    });
  });

  it("ends on a missing cursor and on an empty answer", async () => {
    const last = scripted({ status: "data", data: { visits: { items: [], nextCursor: null } } });
    expect(await last.service.more("m1", "c1")).toEqual({
      status: "page",
      items: [],
      nextCursor: null,
    });
    const none = scripted({ status: "empty" });
    expect(await none.service.more("m1", "c1")).toEqual({
      status: "page",
      items: [],
      nextCursor: null,
    });
  });

  it("reports network and API failures", async () => {
    expect(
      await scripted({ status: "network", message: "offline" }).service.more("m1", "c1"),
    ).toEqual({ status: "failed", message: "offline" });
    expect(
      await scripted({ status: "error", error: { message: "Nope" } }).service.more("m1", "c1"),
    ).toEqual({ status: "failed", message: "Nope" });
  });
});
