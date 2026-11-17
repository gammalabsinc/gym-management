import { describe, expect, it } from "vitest";
import { localTimeIn } from "./calendar";
import { groupVisitsByMonth, toMemberCard, toMemberProfile } from "./member-self";
import type { MemberView } from "./member-view";
import { brandingFromJson, DEFAULT_SETTINGS, type Tenant } from "./tenant";

const TENANT: Tenant = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Iron Works",
  subdomain: "iron",
  timezone: "America/Toronto",
  currency: "CAD",
  branding: brandingFromJson({ primary_color: "#112233", contact: { phone: "555" } }),
  settings: DEFAULT_SETTINGS,
};

const MEMBER: MemberView = {
  id: "11111111-1111-4111-8111-111111111111",
  memberNo: "M-0001",
  barcode: "BC-123",
  name: "Ada Lovelace",
  email: "ada@example.test",
  phone: "555-0100",
  photoRef: null,
  status: "paused",
  plan: {
    id: "p1",
    key: "default",
    name: "Default",
    admissionFee: 2000,
    monthlyFee: 5000,
    isActive: true,
  },
  joinedOn: "2026-01-05",
  leftOn: null,
  billingDay: 5,
  referredBy: "someone-else",
  paidThrough: "2026-10-31",
  standing: "inactive",
  balanceDue: 900,
  credit: 100,
  visitsThisMonth: 3,
  visitsLastMonth: 4,
  totalPaid: 5000,
};

describe("toMemberCard", () => {
  it("carries the card fields and keeps paused apart from the standing", () => {
    expect(toMemberCard(MEMBER, TENANT)).toEqual({
      gym: { name: "Iron Works", primaryColor: "#112233" },
      barcode: "BC-123",
      memberNo: "M-0001",
      name: "Ada Lovelace",
      standing: "inactive",
      membershipStatus: "paused",
      paidThrough: "2026-10-31",
    });
  });
});

describe("toMemberProfile", () => {
  it("shows only the read only profile fields, no money and no referral", () => {
    expect(toMemberProfile(MEMBER)).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.test",
      planName: "Default",
      memberNo: "M-0001",
      joinedOn: "2026-01-05",
    });
  });
});

describe("groupVisitsByMonth", () => {
  it("is empty without visits", () => {
    expect(groupVisitsByMonth([], "America/Toronto")).toEqual([]);
  });

  it("groups by the gym's month with the gym's day and time", () => {
    const months = groupVisitsByMonth(
      [
        { id: "a", scannedAt: "2026-12-01T03:30:00.000000Z", localDate: "2026-11-30" },
        { id: "b", scannedAt: "2026-11-20T15:00:00.000000Z", localDate: "2026-11-20" },
        { id: "c", scannedAt: "2026-10-31T23:15:00.000000Z", localDate: "2026-10-31" },
      ],
      "America/Toronto",
    );
    expect(months).toEqual([
      {
        month: "2026-11",
        visits: [
          { id: "a", day: "2026-11-30", time: "22:30" },
          { id: "b", day: "2026-11-20", time: "10:00" },
        ],
      },
      { month: "2026-10", visits: [{ id: "c", day: "2026-10-31", time: "19:15" }] },
    ]);
  });
});

describe("localTimeIn", () => {
  it("writes midnight as 00:00 on a 24 hour clock", () => {
    expect(localTimeIn(new Date("2026-11-20T05:00:00Z"), "America/Toronto")).toBe("00:00");
  });
});
