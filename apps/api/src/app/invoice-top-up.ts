import { generateInvoicesInUnit } from "./invoices";
import type {
  Clock,
  Logger,
  TenantJobLock,
  TenantRegistry,
  TopUpUnit,
  WithTenantTx,
} from "./ports";

export interface InvoiceTopUpDeps {
  readonly tenants: TenantRegistry;
  readonly lock: TenantJobLock;
  readonly withUnit: WithTenantTx<TopUpUnit>;
  readonly clock: Clock;
  /** Every line of the run goes through it, with the gym's id added for the gym being worked on. */
  readonly logger: Logger;
}

export interface TopUpContext {
  /** Ties the run to its log lines and audit events. */
  readonly requestId: string;
}

export interface TopUpSummary {
  readonly tenants: number;
  /** Gyms another worker was already working on. They are left to it. */
  readonly skippedTenants: number;
  /** Gyms where something went wrong, however small. */
  readonly failedTenants: number;
  readonly invoices: number;
  readonly failedMembers: number;
}

interface TenantOutcome {
  readonly invoices: number;
  readonly failedMembers: number;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The gym's warning window and the members who are active in it, read in one transaction. */
async function readPlan(deps: InvoiceTopUpDeps, tenantId: string) {
  return deps.withUnit(tenantId, async (unit) => {
    const tenant = await unit.tenants.find();
    if (tenant === null) throw new Error("The gym of this transaction cannot be read");
    return {
      warnDaysBefore: tenant.settings.warnDaysBefore,
      memberIds: await unit.roster.activeMemberIds(),
    };
  });
}

/**
 * Builds the invoices that are due for one gym. Each member is its own transaction, so one member
 * that fails is logged with the gym and member ids and the rest still get their invoices.
 */
async function topUpTenant(
  deps: InvoiceTopUpDeps,
  tenantId: string,
  ctx: TopUpContext,
  logger: Logger,
): Promise<TenantOutcome> {
  const { warnDaysBefore, memberIds } = await readPlan(deps, tenantId);
  let invoices = 0;
  let failedMembers = 0;
  for (const memberId of memberIds) {
    try {
      const generated = await deps.withUnit(tenantId, (unit) =>
        generateInvoicesInUnit(
          unit,
          deps.clock,
          { memberId, ahead: 0, lookAheadDays: warnDaysBefore },
          { tenantId, actorUserId: null, requestId: ctx.requestId },
        ),
      );
      if (generated.ok) {
        invoices += generated.value.invoices.length;
      } else {
        failedMembers += 1;
        logger.error("invoice top up refused a member", {
          memberId,
          reason: generated.error.message,
        });
      }
    } catch (error) {
      failedMembers += 1;
      logger.error("invoice top up failed for a member", { memberId, reason: describe(error) });
    }
  }
  return { invoices, failedMembers };
}

/**
 * The daily job: for every gym that is switched on, builds the next invoice of each active member
 * whose next cycle starts within the gym's warning window. Running it twice builds nothing new.
 * A lock per gym stops two workers doing the same gym together, and a gym that fails is logged
 * with its id and does not stop the gyms after it.
 */
export function makeInvoiceTopUp(deps: InvoiceTopUpDeps) {
  return async (ctx: TopUpContext): Promise<TopUpSummary> => {
    const tenantIds = await deps.tenants.activeTenantIds();
    let skippedTenants = 0;
    let failedTenants = 0;
    let invoices = 0;
    let failedMembers = 0;
    for (const tenantId of tenantIds) {
      const logger = deps.logger.child({ requestId: ctx.requestId, tenantId });
      try {
        const outcome = await deps.lock.runExclusive(tenantId, () =>
          topUpTenant(deps, tenantId, ctx, logger),
        );
        if (!outcome.ran) {
          skippedTenants += 1;
          logger.info("invoice top up skipped, another worker has this gym");
          continue;
        }
        invoices += outcome.value.invoices;
        failedMembers += outcome.value.failedMembers;
        if (outcome.value.failedMembers > 0) failedTenants += 1;
        logger.info("invoice top up finished", { ...outcome.value });
      } catch (error) {
        failedTenants += 1;
        logger.error("invoice top up failed for a gym", { reason: describe(error) });
      }
    }
    return {
      tenants: tenantIds.length,
      skippedTenants,
      failedTenants,
      invoices,
      failedMembers,
    };
  };
}
