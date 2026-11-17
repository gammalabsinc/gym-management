import { describe, expect, it } from "vitest";
import { MAX_BACKDATE_DAYS } from "./member";
import { parseNewGym } from "./onboarding";
import { DEV_GYMS } from "./seed-data";
import { parseInvite } from "./staff";

describe("the dev seed fixtures", () => {
  it("has two gyms that onboarding accepts", () => {
    expect(DEV_GYMS).toHaveLength(2);
    for (const fixture of DEV_GYMS) expect(parseNewGym(fixture.gym).ok).toBe(true);
  });

  it("gives each gym a staff member the invite rules accept", () => {
    for (const fixture of DEV_GYMS) {
      expect(fixture.staff.role).toBe("staff");
      expect(parseInvite(fixture.staff).ok).toBe(true);
    }
  });

  it("uses each email once, and no staff email is also a member", () => {
    const emails = DEV_GYMS.flatMap((fixture) => [
      fixture.gym.ownerEmail,
      fixture.staff.email,
      ...fixture.members.map((member) => member.email),
    ]);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it("joins every member in the past and inside the backdate limit", () => {
    for (const member of DEV_GYMS.flatMap((fixture) => fixture.members)) {
      expect(member.daysSinceJoin).toBeGreaterThan(0);
      expect(member.daysSinceJoin).toBeLessThanOrEqual(MAX_BACKDATE_DAYS);
    }
  });
});
