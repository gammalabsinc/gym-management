import {
  type BackfillDiscount,
  type BackfillMember,
  type BackfillMemberInput,
  parseBackfill,
} from "../domain/backfill";
import { localDateIn } from "../domain/calendar";
import type { ValidationError } from "../domain/errors";
import { ACTION_TO_REACH } from "../domain/membership";
import { DEFAULT_PLAN_KEY } from "../domain/plans";
import { ok, type Result } from "../domain/result";
import type { Tenant } from "../domain/tenant";
import { MEMBERSHIP_AUDIT_ACTIONS } from "./change-membership";
import { insertWithFreeCodes, MEMBER_CREATED } from "./create-member";
import { generateInvoicesInUnit, type InvoiceContext } from "./invoices";
import { settlePayment } from "./payment-allocation";
import type { BackfillUnit, Clock, CodeGenerator, WithTenantTx } from "./ports";
import { PAYMENT_RECORDED } from "./record-payment";

export interface BackfillDeps {
  readonly withUnit: WithTenantTx<BackfillUnit>;
  /** Today, which is also the day the invoices are built up to. */
  readonly clock: Clock;
  /** A clock that reads as a given day of the gym's calendar, to build invoices as of a past change. */
  readonly clockOn: (localDate: string, timeZone: string) => Clock;
  readonly codes: CodeGenerator;
  /** The same text always gives the same uuid, so a payment keeps its request id from run to run. */
  readonly stableId: (seed: string) => string;
}

/** The gym is chosen by whoever runs the script. There is no signed in caller, so no actor. */
export interface BackfillContext {
  readonly tenantId: string;
  readonly requestId: string;
}

export interface BackfillOptions {
  /** True when the caller rolls everything back, so a member that only exists in this run still counts. */
  readonly dryRun: boolean;
}

export type MemberOutcome = "created" | "existing" | "failed";

export interface MemberReport {
  readonly email: string;
  readonly outcome: MemberOutcome;
  /** Status changes replayed from the history. */
  readonly statusChanges: number;
  readonly invoices: number;
  readonly payments: number;
  /** Payments that were loaded by an earlier run. */
  readonly paymentsSkipped: number;
  readonly discounts: number;
  /** Why a member was not loaded. Null otherwise. */
  readonly problem: string | null;
}

export interface BackfillReport {
  readonly members: readonly MemberReport[];
}

export const BACKFILL_SOURCE = "backfill";

interface Env {
  readonly tenant: Tenant;
  readonly today: string;
  /** The gym's first owner. A payment needs a user that recorded it, and nobody signed in. */
  readonly ownerId: string;
  readonly planId: string;
  readonly billing: InvoiceContext;
  readonly options: BackfillOptions;
  /** Emails of the members handled so far in this run. */
  readonly seen: ReadonlySet<string>;
}

interface ResolvedDiscount {
  readonly discount: BackfillDiscount;
  /** Null for a manual discount, and for a referral whose source only exists in this dry run. */
  readonly sourceMemberId: string | null;
}

const EMPTY: MemberReport = {
  email: "",
  outcome: "failed",
  statusChanges: 0,
  invoices: 0,
  payments: 0,
  paymentsSkipped: 0,
  discounts: 0,
  problem: null,
};

async function memberIdByEmail(unit: BackfillUnit, email: string): Promise<string | null> {
  const user = await unit.staff.findByEmail(email);
  return user === null ? null : unit.members.findIdByUser(user.userId);
}

/**
 * Looks up the member each referral came from, before anything is written, so a member that
 * cannot be loaded leaves nothing behind. In a dry run nothing is kept, so a source earlier in
 * the same file counts as present.
 */
async function resolveDiscounts(
  unit: BackfillUnit,
  member: BackfillMember,
  env: Env,
): Promise<Result<readonly ResolvedDiscount[], string>> {
  const resolved: ResolvedDiscount[] = [];
  for (const discount of member.discounts) {
    if (discount.sourceEmail === null) {
      resolved.push({ discount, sourceMemberId: null });
      continue;
    }
    const sourceMemberId = await memberIdByEmail(unit, discount.sourceEmail);
    const plannedInThisRun = env.options.dryRun && env.seen.has(discount.sourceEmail);
    if (sourceMemberId === null && !plannedInThisRun) {
      return {
        ok: false,
        error: `The referral source ${discount.sourceEmail} is not a member yet`,
      };
    }
    resolved.push({ discount, sourceMemberId });
  }
  return ok(resolved);
}

/** Builds every invoice that is due, as many passes as it takes, because one pass builds at most ten years. */
async function generateThrough(
  unit: BackfillUnit,
  clock: Clock,
  memberId: string,
  billing: InvoiceContext,
): Promise<number> {
  let total = 0;
  for (;;) {
    const result = await generateInvoicesInUnit(unit, clock, { memberId, ahead: 0 }, billing);
    // The member was just read and the dates were checked, so a failure here is a bug.
    if (!result.ok) throw new Error(`Invoice generation failed: ${result.error.message}`);
    if (result.value.invoices.length === 0) return total;
    total += result.value.invoices.length;
  }
}

async function createMember(
  unit: BackfillUnit,
  member: BackfillMember,
  env: Env,
  codes: CodeGenerator,
): Promise<string> {
  const existing = await unit.staff.findByEmail(member.email);
  const userId =
    existing?.userId ??
    (await unit.staff.createUser({
      email: member.email,
      name: member.fullName,
      phone: member.phone,
    }));
  if (userId === null) throw new Error("The person was added by someone else during the backfill");
  await unit.staff.addRole(userId, "member");
  const inserted = await insertWithFreeCodes(unit, codes, userId, {
    billingDay: member.billingDay,
    referredBy: null,
  });
  if (!inserted.ok) throw new Error(`The member could not be added: ${inserted.error.message}`);
  const { memberId, memberNo } = inserted.value;
  await unit.members.openPeriod({
    memberId,
    planId: env.planId,
    validFrom: member.joinDate,
    changedBy: env.ownerId,
  });
  await unit.audit.record({
    actorUserId: null,
    action: MEMBER_CREATED,
    entityType: "member",
    entityId: memberId,
    before: null,
    after: {
      userId,
      memberNo,
      planId: env.planId,
      joinDate: member.joinDate,
      billingDay: member.billingDay,
      source: BACKFILL_SOURCE,
    },
    requestId: env.billing.requestId,
  });
  return memberId;
}

/** Inserts the discounts as they stand today. The referral defaults of the gym never run here. */
async function insertDiscounts(
  unit: BackfillUnit,
  memberId: string,
  discounts: readonly ResolvedDiscount[],
  env: Env,
): Promise<number> {
  let inserted = 0;
  for (const { discount, sourceMemberId } of discounts) {
    // A referral whose source exists only in a dry run is counted, never written.
    if (discount.sourceEmail !== null && sourceMemberId === null) {
      inserted += 1;
      continue;
    }
    const id = await unit.discounts.insertDiscountIfAbsent({
      memberId,
      kind: discount.kind,
      referralSide: discount.referralSide,
      sourceMemberId,
      amount: discount.amount,
      isRecurring: discount.isRecurring,
      reason: discount.reason,
      startsOn: discount.startsOn,
      endsOn: discount.endsOn,
      createdBy: env.ownerId,
    });
    if (id !== null) inserted += 1;
  }
  return inserted;
}

/**
 * Replays the status history in date order. Invoices are built as of each change first, so the
 * cycles the member was active for are billed and the cycles after a pause or a cancellation are
 * not.
 */
async function replayHistory(
  unit: BackfillUnit,
  memberId: string,
  member: BackfillMember,
  env: Env,
  deps: BackfillDeps,
): Promise<number> {
  let invoices = 0;
  for (const change of member.statusHistory) {
    invoices += await generateThrough(
      unit,
      deps.clockOn(change.from, env.tenant.timezone),
      memberId,
      env.billing,
    );
    const current = await unit.periods.lockCurrent(memberId);
    if (current === null) throw new Error("A member that was just added has no current period");
    await unit.periods.close(current.id, change.from);
    await unit.periods.open({
      memberId,
      planId: current.planId,
      status: change.status,
      validFrom: change.from,
      reason: change.reason,
      changedBy: env.ownerId,
    });
    await unit.audit.record({
      actorUserId: null,
      action: MEMBERSHIP_AUDIT_ACTIONS[ACTION_TO_REACH[change.status]],
      entityType: "member",
      entityId: memberId,
      before: { status: current.status, validFrom: current.validFrom },
      after: { status: change.status, validFrom: change.from, reason: change.reason },
      requestId: env.billing.requestId,
    });
  }
  return invoices;
}

/**
 * Records the payments oldest first with the live settling code, so a cycle that was truly never
 * paid stays unpaid. Each payment's request id comes from who paid, when and how much, so a
 * payment loaded by an earlier run is found and skipped.
 */
async function recordPayments(
  unit: BackfillUnit,
  memberId: string,
  member: BackfillMember,
  env: Env,
  deps: BackfillDeps,
): Promise<{ recorded: number; skipped: number }> {
  let recorded = 0;
  let skipped = 0;
  for (const payment of member.payments) {
    const clientRequestId = deps.stableId(
      [env.billing.tenantId, member.email, payment.paidOn, payment.amount, payment.ordinal].join(
        "|",
      ),
    );
    if ((await unit.payments.findByRequestId(clientRequestId)) !== null) {
      skipped += 1;
      continue;
    }
    const stored = await unit.payments.insert({
      clientRequestId,
      memberId,
      amount: payment.amount,
      method: payment.method,
      paidOn: payment.paidOn,
      proofLink: null,
      recordedBy: env.ownerId,
    });
    if (stored === null) throw new Error("A backfill payment request id belongs to another member");
    const settled = await settlePayment(unit, deps.clock, env.billing, {
      memberId,
      amount: payment.amount,
    });
    if (!settled.ok) throw new Error(`Payment settling failed: ${settled.error.message}`);
    await unit.payments.insertAllocations(stored.id, settled.value.allocations);
    await unit.audit.record({
      actorUserId: null,
      action: PAYMENT_RECORDED,
      entityType: "payment",
      entityId: stored.id,
      before: null,
      after: {
        memberId,
        amount: payment.amount,
        method: payment.method,
        paidOn: payment.paidOn,
        invoices: settled.value.allocations.length,
        credit: settled.value.credit,
        source: BACKFILL_SOURCE,
      },
      requestId: env.billing.requestId,
    });
    recorded += 1;
  }
  return { recorded, skipped };
}

async function loadMember(
  unit: BackfillUnit,
  member: BackfillMember,
  env: Env,
  deps: BackfillDeps,
): Promise<MemberReport> {
  const resolved = await resolveDiscounts(unit, member, env);
  if (!resolved.ok) return { ...EMPTY, email: member.email, problem: resolved.error };
  const existingId = await memberIdByEmail(unit, member.email);
  const memberId = existingId ?? (await createMember(unit, member, env, deps.codes));
  const discounts = await insertDiscounts(unit, memberId, resolved.value, env);
  // A member that is there already keeps the history it was loaded with.
  const statusChanges = existingId === null ? member.statusHistory.length : 0;
  const replayed = existingId === null ? await replayHistory(unit, memberId, member, env, deps) : 0;
  const current = await generateThrough(unit, deps.clock, memberId, env.billing);
  const payments = await recordPayments(unit, memberId, member, env, deps);
  return {
    email: member.email,
    outcome: existingId === null ? "created" : "existing",
    statusChanges,
    invoices: replayed + current,
    payments: payments.recorded,
    paymentsSkipped: payments.skipped,
    discounts,
    problem: null,
  };
}

/** Reads what every member shares: the gym, today, the plan and the owner that stands in as the recorder. */
async function readEnv(
  unit: BackfillUnit,
  ctx: BackfillContext,
  today: string,
  tenant: Tenant,
  options: BackfillOptions,
  seen: ReadonlySet<string>,
): Promise<Env> {
  const plan = await unit.plans.findByKey(DEFAULT_PLAN_KEY);
  if (plan === null || !plan.isActive) throw new Error("This gym has no active plan yet");
  const [ownerId] = await unit.staff.lockOwners();
  if (ownerId === undefined) throw new Error("This gym has no owner yet");
  return {
    tenant,
    today,
    ownerId,
    planId: plan.id,
    billing: { tenantId: ctx.tenantId, actorUserId: null, requestId: ctx.requestId },
    options,
    seen,
  };
}

/**
 * Loads the members of a gym that already exists from the old records, once, at provisioning.
 * The whole file is checked before anything is written. Then each member goes in its own
 * transaction: the person, the member, the discounts as they are today, the invoices from the join
 * date to today for the stretches the member was active, and the payments settled oldest first.
 * Audit events carry no actor. Running it again writes nothing twice. A member that cannot be
 * loaded is reported and the rest carry on, and an unexpected error rolls that member back and
 * stops the run.
 */
export function makeBackfill(deps: BackfillDeps) {
  return async (
    inputs: readonly BackfillMemberInput[],
    ctx: BackfillContext,
    options: BackfillOptions,
  ): Promise<Result<BackfillReport, ValidationError>> => {
    const tenant = await deps.withUnit(ctx.tenantId, (unit) => unit.tenants.find());
    if (tenant === null) throw new Error("The gym cannot be read");
    const today = localDateIn(deps.clock.now(), tenant.timezone);
    const parsed = parseBackfill(inputs, today);
    if (!parsed.ok) return parsed;

    const members: MemberReport[] = [];
    const seen = new Set<string>();
    for (const member of parsed.value) {
      const report = await deps.withUnit(ctx.tenantId, async (unit) =>
        loadMember(unit, member, await readEnv(unit, ctx, today, tenant, options, seen), deps),
      );
      members.push(report);
      seen.add(member.email);
    }
    return ok({ members });
  };
}
