import { describe, expect, it, vi } from "vitest";
import { conflict, type DomainError, validationError } from "../domain/errors";
import { err, ok, type Result } from "../domain/result";
import { SEED_REASONS, type SeedGym } from "../domain/seed-data";
import type { ChangedMembership } from "./change-membership";
import type { CreatedMember } from "./create-member";
import type { OnboardedGym } from "./onboarding";
import type { AuditEvent, SeedPaymentRow } from "./ports";
import type { StaffMember } from "./role-management";
import { makeSeedDevData, SEED_PAYMENT_RECORDED, type SeedDevDataDeps } from "./seed-dev-data";

const NOW = new Date("2026-11-16T15:00:00.000Z");
const TENANT_ID = "tenant-1";
const OWNER_ID = "owner-1";

const FIXTURE: SeedGym = {
  gym: {
    name: "Test Gym",
    subdomain: "testgym",
    timezone: "America/Toronto",
    currency: "CAD",
    ownerEmail: "owner@test.test",
    ownerName: "Owen Owner",
    admissionFee: 5000,
    monthlyFee: 4000,
  },
  staff: { email: "staff@test.test", name: "Sam Staff", role: "staff" },
  members: [
    { fullName: "A Paid", email: "a@test.test", phone: null, daysSinceJoin: 10, scenario: "paid" },
    {
      fullName: "B Due",
      email: "b@test.test",
      phone: null,
      daysSinceJoin: 3,
      scenario: "due_soon",
    },
    {
      fullName: "C Late",
      email: "c@test.test",
      phone: null,
      daysSinceJoin: 12,
      scenario: "overdue",
    },
    {
      fullName: "D Away",
      email: "d@test.test",
      phone: null,
      daysSinceJoin: 20,
      scenario: "paused",
    },
    {
      fullName: "E Gone",
      email: "e@test.test",
      phone: null,
      daysSinceJoin: 25,
      scenario: "cancelled",
    },
  ],
};

function makeHarness() {
  let counter = 0;
  const payments: SeedPaymentRow[] = [];
  const audit: AuditEvent[] = [];
  const onboard = vi.fn(
    async (): Promise<Result<OnboardedGym, DomainError>> =>
      ok({ tenantId: TENANT_ID, subdomain: "testgym", created: true }),
  );
  const inviteUser = vi.fn(
    async (): Promise<Result<StaffMember, DomainError>> =>
      ok({
        userId: "staff-1",
        name: "Sam Staff",
        email: "staff@test.test",
        roles: ["staff"],
        hasSignedIn: false,
      }),
  );
  const createMember = vi.fn(
    async (input: { email: string }): Promise<Result<CreatedMember, DomainError>> =>
      ok({
        memberId: `member-${input.email}`,
        userId: `user-${input.email}`,
        memberNo: "000001",
        barcode: "ABC234",
        invoices: [
          {
            id: `invoice-${input.email}`,
            periodStart: "2026-11-06",
            periodEnd: "2026-12-05",
            total: 9000,
          },
        ],
      }),
  );
  const changed: Result<ChangedMembership, DomainError> = ok({
    memberId: "m",
    status: "paused",
    effectiveFrom: "2026-11-16",
  });
  const pauseMember = vi.fn(
    async (_input: {
      memberId: string;
      reason: string;
    }): Promise<Result<ChangedMembership, DomainError>> => changed,
  );
  const cancelMember = vi.fn(
    async (_input: {
      memberId: string;
      reason: string;
    }): Promise<Result<ChangedMembership, DomainError>> => changed,
  );
  const findUserIdByEmail = vi.fn(
    async (_tenantId: string, _email: string): Promise<string | null> => OWNER_ID,
  );
  const deps: SeedDevDataDeps = {
    clock: { now: () => NOW },
    ids: { next: () => `id-${++counter}` },
    onboard,
    inviteUser,
    createMember,
    pauseMember,
    cancelMember,
    findUserIdByEmail,
    withPaymentUnit: (_tenantId, fn) =>
      fn({
        payments: {
          insertPaid: async (row) => {
            payments.push(row);
            return `payment-${payments.length}`;
          },
        },
        audit: {
          record: async (event) => {
            audit.push(event);
          },
        },
      }),
  };
  return {
    deps,
    payments,
    audit,
    onboard,
    inviteUser,
    createMember,
    pauseMember,
    cancelMember,
    findUserIdByEmail,
  };
}

describe("makeSeedDevData", () => {
  it("seeds a new gym as its owner: the staff member, then every member in its scenario", async () => {
    const h = makeHarness();
    const seeded = await makeSeedDevData(h.deps)([FIXTURE]);

    expect(seeded).toEqual([
      { subdomain: "testgym", tenantId: TENANT_ID, created: true, members: 5 },
    ]);
    expect(h.findUserIdByEmail).toHaveBeenCalledWith(TENANT_ID, "owner@test.test");
    const actor = expect.objectContaining({
      tenantId: TENANT_ID,
      userId: OWNER_ID,
      roles: ["owner"],
    });
    expect(h.inviteUser).toHaveBeenCalledWith(FIXTURE.staff, actor);
    expect(h.createMember.mock.calls.map(([input]) => input)).toEqual([
      expect.objectContaining({ email: "a@test.test", joinDate: "2026-11-06" }),
      expect.objectContaining({ email: "b@test.test", joinDate: "2026-11-13" }),
      expect.objectContaining({ email: "c@test.test", joinDate: "2026-11-04" }),
      expect.objectContaining({ email: "d@test.test", joinDate: "2026-10-27" }),
      expect.objectContaining({ email: "e@test.test", joinDate: "2026-10-22" }),
    ]);
  });

  it("pays only the paid members, in full, and records each payment", async () => {
    const h = makeHarness();
    await makeSeedDevData(h.deps)([FIXTURE]);

    expect(h.payments).toEqual([
      {
        memberId: "member-a@test.test",
        invoiceId: "invoice-a@test.test",
        amount: 9000,
        paidOn: "2026-11-16",
        recordedBy: OWNER_ID,
        clientRequestId: expect.any(String),
      },
    ]);
    expect(h.audit).toEqual([
      expect.objectContaining({
        action: SEED_PAYMENT_RECORDED,
        entityType: "payment",
        entityId: "payment-1",
        actorUserId: OWNER_ID,
      }),
    ]);
  });

  it("pauses and cancels only the members whose scenario says so, with a reason", async () => {
    const h = makeHarness();
    await makeSeedDevData(h.deps)([FIXTURE]);

    expect(h.pauseMember).toHaveBeenCalledTimes(1);
    expect(h.pauseMember.mock.calls[0]?.[0]).toEqual({
      memberId: "member-d@test.test",
      reason: SEED_REASONS.paused,
    });
    expect(h.cancelMember).toHaveBeenCalledTimes(1);
    expect(h.cancelMember.mock.calls[0]?.[0]).toEqual({
      memberId: "member-e@test.test",
      reason: SEED_REASONS.cancelled,
    });
  });

  it("uses the gym's own calendar for today", async () => {
    const h = makeHarness();
    const late = { ...FIXTURE, gym: { ...FIXTURE.gym, timezone: "Pacific/Auckland" } };
    await makeSeedDevData(h.deps)([{ ...late, members: FIXTURE.members.slice(1, 2) }]);
    expect(h.createMember.mock.calls[0]?.[0]).toMatchObject({ joinDate: "2026-11-14" });
  });

  it("leaves a gym that already exists alone", async () => {
    const h = makeHarness();
    h.onboard.mockResolvedValueOnce(
      ok({ tenantId: TENANT_ID, subdomain: "testgym", created: false }),
    );
    const seeded = await makeSeedDevData(h.deps)([FIXTURE]);

    expect(seeded).toEqual([
      { subdomain: "testgym", tenantId: TENANT_ID, created: false, members: 0 },
    ]);
    expect(h.findUserIdByEmail).not.toHaveBeenCalled();
    expect(h.inviteUser).not.toHaveBeenCalled();
    expect(h.createMember).not.toHaveBeenCalled();
  });

  it("stops and names the step when the gym is invalid", async () => {
    const h = makeHarness();
    h.onboard.mockResolvedValueOnce(validationError("Invalid gym"));
    await expect(makeSeedDevData(h.deps)([FIXTURE])).rejects.toThrow(
      "Seed step failed, onboard testgym: Invalid gym",
    );
    expect(h.createMember).not.toHaveBeenCalled();
  });

  it("stops when the owner of a new gym cannot be found", async () => {
    const h = makeHarness();
    h.findUserIdByEmail.mockResolvedValueOnce(null);
    await expect(makeSeedDevData(h.deps)([FIXTURE])).rejects.toThrow(
      "A gym that was just created has no owner",
    );
  });

  it("stops and names the step when the staff invite fails", async () => {
    const h = makeHarness();
    h.inviteUser.mockResolvedValueOnce(validationError("Invalid invite"));
    await expect(makeSeedDevData(h.deps)([FIXTURE])).rejects.toThrow(
      "Seed step failed, invite staff@test.test: Invalid invite",
    );
  });

  it("stops and names the step when a member cannot be created", async () => {
    const h = makeHarness();
    h.createMember.mockResolvedValueOnce(conflict("This person is already a member here"));
    await expect(makeSeedDevData(h.deps)([FIXTURE])).rejects.toThrow(
      "Seed step failed, create member a@test.test: This person is already a member here",
    );
    expect(h.payments).toEqual([]);
  });

  it("stops and names the step when a pause or a cancel fails", async () => {
    const paused = makeHarness();
    paused.pauseMember.mockResolvedValueOnce(err({ kind: "conflict", message: "Already paused" }));
    await expect(makeSeedDevData(paused.deps)([FIXTURE])).rejects.toThrow(
      "Seed step failed, pause member d@test.test: Already paused",
    );

    const cancelled = makeHarness();
    cancelled.cancelMember.mockResolvedValueOnce(
      err({ kind: "conflict", message: "Already cancelled" }),
    );
    await expect(makeSeedDevData(cancelled.deps)([FIXTURE])).rejects.toThrow(
      "Seed step failed, cancel member e@test.test: Already cancelled",
    );
  });
});
