import { describe, expect, it } from "vitest";
import type { Membership, ScanOutcome, Standing } from "./scan";
import { describeScan } from "./scan-card";

type Recorded = Extract<ScanOutcome, { status: "recorded" }>;

const recorded = (over: Partial<Recorded> = {}): Recorded => ({
  status: "recorded",
  memberId: "m1",
  memberName: "Ayesha Khan",
  standing: "PAID" as Standing,
  paidThrough: "2026-12-13",
  membership: "ACTIVE" as Membership,
  leftOn: null,
  isDuplicate: false,
  ...over,
});

describe("describeScan, the seven drawn states", () => {
  it("welcomes a paid member in green", () => {
    expect(describeScan(recorded(), null)).toEqual({
      tone: "welcome",
      glyph: "check",
      shape: "circle",
      title: "Welcome",
      name: "Ayesha Khan",
      line: "Paid through Dec 13, 2026",
      note: null,
    });
  });

  it("gives a heads up when payment is due soon", () => {
    expect(
      describeScan(recorded({ standing: "DUE_SOON", paidThrough: "2026-11-17" }), null),
    ).toMatchObject({
      tone: "headsUp",
      title: "Heads up",
      line: "Paid through Nov 17, 2026",
      note: "Payment due soon.",
    });
  });

  it("says overdue, in an octagon", () => {
    expect(
      describeScan(recorded({ standing: "OVERDUE", paidThrough: "2026-10-01" }), null),
    ).toMatchObject({
      tone: "overdue",
      shape: "octagon",
      title: "Overdue",
      line: "Paid through Oct 1, 2026",
      note: "Payment is overdue. Let them in and remind them.",
    });
  });

  it("says overdue differently for a new member who has not paid", () => {
    expect(describeScan(recorded({ standing: "OVERDUE", paidThrough: null }), null)).toMatchObject({
      tone: "overdue",
      line: "Not paid yet",
      note: "First payment is overdue. Let them in and remind them.",
    });
  });

  it("shows a cancelled member as not active, grey and never green", () => {
    const view = describeScan(
      recorded({ standing: "INACTIVE", membership: "CANCELLED", leftOn: "2026-10-30" }),
      null,
    );
    expect(view).toMatchObject({
      tone: "neutral",
      glyph: "dash",
      title: "Not active",
      line: "Cancelled on Oct 30, 2026",
      note: "Membership is cancelled. Let them in and send them to the owner.",
    });
  });

  it("chooses not active from the membership even when the standing says paid", () => {
    expect(describeScan(recorded({ standing: "PAID", membership: "PAUSED" }), null)).toMatchObject({
      title: "Not active",
      line: "Paused",
    });
  });

  it("words a cancelled member without a date and an active one without a running membership", () => {
    expect(
      describeScan(recorded({ standing: "INACTIVE", membership: "CANCELLED" }), null),
    ).toMatchObject({ line: "Cancelled" });
    expect(describeScan(recorded({ standing: "INACTIVE" }), null)).toMatchObject({
      title: "Not active",
      line: "No running membership",
      note: "Membership is not active. Let them in and send them to the owner.",
    });
  });

  it("shows a repeat with the time of the first check in, in the gym's time zone", () => {
    const view = describeScan(recorded({ isDuplicate: true, standing: "OVERDUE" }), {
      status: "found",
      at: "2026-11-26T12:12:00Z",
      timezone: "America/Toronto",
    });
    expect(view).toMatchObject({
      tone: "neutral",
      title: "Already checked in",
      name: "Ayesha Khan",
      line: "Checked in at 7:12 AM",
      note: null,
    });
  });

  it("falls back when the first check in is unknown or was not looked up", () => {
    const repeat = recorded({ isDuplicate: true });
    expect(describeScan(repeat, { status: "unknown" }).line).toBe("Checked in earlier");
    expect(describeScan(repeat, null).line).toBe("Checked in earlier");
  });

  it("names a member who has no name on file", () => {
    expect(describeScan(recorded({ memberName: null }), null).name).toBe("Member");
  });

  it("shows an unknown barcode with no member", () => {
    expect(describeScan({ status: "notRecognized" }, null)).toEqual({
      tone: "neutral",
      glyph: "help",
      shape: "circle",
      title: "Barcode not recognized",
      name: null,
      line: null,
      note: "Try again, or search by name.",
    });
  });

  it("shows a request error with its own message, never as not recognized", () => {
    const view = describeScan({ status: "failed", message: "Nope." }, null);
    expect(view).toMatchObject({ title: "Could not check in", note: "Nope.", name: null });
    expect(view.title).not.toBe("Barcode not recognized");
  });
});
