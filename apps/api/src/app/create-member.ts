import { localDateIn } from "../domain/calendar";
import {
  type ConflictError,
  conflict,
  type ValidationError,
  validationError,
} from "../domain/errors";
import {
  MAX_CODE_ATTEMPTS,
  type NewMember,
  type NewMemberInput,
  parseNewMember,
} from "../domain/member";
import { DEFAULT_PLAN_KEY } from "../domain/plans";
import { ok, type Result } from "../domain/result";
import { type GeneratedInvoice, generateInvoicesInUnit } from "./invoices";
import type { Clock, CodeGenerator, MemberUnit, WithTenantTx } from "./ports";
import { applyReferral } from "./referral";
import { type PermissionContext, requirePermission } from "./require-permission";

export const MEMBER_CREATED = "member.created";
export const ALREADY_A_MEMBER_MESSAGE = "This person is already a member here";

export interface CreateMemberDeps {
  readonly withUnit: WithTenantTx<MemberUnit>;
  readonly clock: Clock;
  readonly codes: CodeGenerator;
}

/** The tenant, the caller and the request all come from the session, never from client input. */
export interface CreateMemberContext extends PermissionContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly requestId: string;
}

export interface CreatedMember {
  readonly memberId: string;
  readonly userId: string;
  readonly memberNo: string;
  readonly barcode: string;
  /** The invoices built for the first cycles, the first one with the admission fee. */
  readonly invoices: readonly GeneratedInvoice[];
}

type CreateError = ValidationError | ConflictError;

/**
 * Picks codes until the database accepts a pair. A taken code, in any gym, makes the insert
 * return nothing, and then the person is checked once more, because that is the other reason an
 * insert can be refused. The loop is bounded, so a database that refuses every code is a bug and
 * throws, which rolls the whole change back.
 */
export async function insertWithFreeCodes(
  unit: Pick<MemberUnit, "members">,
  codes: CodeGenerator,
  userId: string,
  member: Pick<NewMember, "billingDay" | "referredBy">,
): Promise<Result<{ memberId: string; memberNo: string; barcode: string }, ConflictError>> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const memberNo = codes.next();
    const barcode = codes.next();
    const memberId = await unit.members.insertIfAbsent({
      userId,
      memberNo,
      barcode,
      billingDay: member.billingDay,
      referredBy: member.referredBy,
    });
    if (memberId !== null) return ok({ memberId, memberNo, barcode });
    if ((await unit.members.findIdByUser(userId)) !== null) {
      return conflict(ALREADY_A_MEMBER_MESSAGE);
    }
  }
  throw new Error(`No free member code after ${MAX_CODE_ATTEMPTS} attempts`);
}

/** The user row of the new member: the one that is already there, or a new one. */
async function userFor(
  unit: MemberUnit,
  member: NewMember,
): Promise<Result<string, ConflictError>> {
  const existing = await unit.staff.findByEmail(member.email);
  if (existing !== null) {
    if ((await unit.members.findIdByUser(existing.userId)) !== null) {
      return conflict(ALREADY_A_MEMBER_MESSAGE);
    }
    return ok(existing.userId);
  }
  const created = await unit.staff.createUser({
    email: member.email,
    name: member.fullName,
    phone: member.phone,
  });
  return created === null ? conflict(ALREADY_A_MEMBER_MESSAGE) : ok(created);
}

/**
 * Adds a member: the person, the member number and barcode, the first active period and the first
 * invoice. The person is found by Google email, so a staff member can also join as a member, and
 * a person who already has a member row in this gym is a conflict the screen can show. The
 * member, the period, the referral discounts, the invoices and the audit event commit together or
 * not at all. The referral discounts are made from the gym's defaults before the first invoice, so
 * the new member's own discount lands on it.
 */
export function makeCreateMember(deps: CreateMemberDeps) {
  return requirePermission<NewMemberInput, CreateMemberContext, CreatedMember, CreateError>(
    "member.create",
    (input, ctx) =>
      deps.withUnit(ctx.tenantId, async (unit): Promise<Result<CreatedMember, CreateError>> => {
        const tenant = await unit.tenants.find();
        if (tenant === null) throw new Error("The gym of this transaction cannot be read");
        const parsed = parseNewMember(input, localDateIn(deps.clock.now(), tenant.timezone));
        if (!parsed.ok) return parsed;
        const member = parsed.value;

        const plan = await unit.plans.findByKey(DEFAULT_PLAN_KEY);
        if (plan === null || !plan.isActive) return conflict("This gym has no active plan yet");
        if (member.referredBy !== null && !(await unit.members.exists(member.referredBy))) {
          return validationError("Invalid member", [
            { path: ["referredBy"], message: "Not a member of this gym" },
          ]);
        }

        const user = await userFor(unit, member);
        if (!user.ok) return user;
        await unit.staff.addRole(user.value, "member");
        const inserted = await insertWithFreeCodes(unit, deps.codes, user.value, member);
        if (!inserted.ok) return inserted;
        const { memberId, memberNo, barcode } = inserted.value;
        await unit.members.openPeriod({
          memberId,
          planId: plan.id,
          validFrom: member.joinDate,
          changedBy: ctx.userId,
        });
        // Before the first invoice, so the new member's own discount lands on it.
        if (member.referredBy !== null) {
          const referral = await applyReferral(unit, {
            memberId,
            referrerId: member.referredBy,
            startsOn: member.joinDate,
            settings: tenant.settings,
            actorUserId: ctx.userId,
            requestId: ctx.requestId,
          });
          // The referrer was just checked and the member just written, so a failure here is a bug.
          // Throwing rolls the member back with it.
          if (!referral.ok) throw new Error(`Referral failed: ${referral.error.message}`);
        }
        const generated = await generateInvoicesInUnit(
          unit,
          deps.clock,
          { memberId, ahead: 0 },
          { tenantId: ctx.tenantId, actorUserId: ctx.userId, requestId: ctx.requestId },
        );
        // The member was just written and the input was just checked, so a failure here is a bug.
        // Throwing rolls the member back with it.
        if (!generated.ok) throw new Error(`First invoice failed: ${generated.error.message}`);
        await unit.audit.record({
          actorUserId: ctx.userId,
          action: MEMBER_CREATED,
          entityType: "member",
          entityId: memberId,
          before: null,
          after: {
            userId: user.value,
            memberNo,
            planId: plan.id,
            joinDate: member.joinDate,
            billingDay: member.billingDay,
            referredBy: member.referredBy,
          },
          requestId: ctx.requestId,
        });
        return ok({
          memberId,
          userId: user.value,
          memberNo,
          barcode,
          invoices: generated.value.invoices,
        });
      }),
  );
}
