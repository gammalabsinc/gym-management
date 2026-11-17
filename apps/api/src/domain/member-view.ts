import type { Plan } from "./plans";
import type { MembershipStatus, Standing } from "./standing";

/** A member as the screens read it: the stored fields plus everything derived from the ledger. */
export interface MemberView {
  readonly id: string;
  readonly memberNo: string;
  readonly barcode: string;
  readonly name: string | null;
  readonly email: string;
  readonly phone: string | null;
  readonly photoRef: string | null;
  /** The status of the current membership period. */
  readonly status: MembershipStatus;
  /** The plan of the current period. */
  readonly plan: Plan;
  /** The day the first period began. */
  readonly joinedOn: string;
  /** The day a cancelled membership ended, otherwise null. */
  readonly leftOn: string | null;
  readonly billingDay: number;
  readonly referredBy: string | null;
  /** The last day covered by invoices that are fully paid with no unpaid invoice before them. */
  readonly paidThrough: string | null;
  readonly standing: Standing;
  /** What is still owed on live invoices due on or before today, in minor units. */
  readonly balanceDue: number;
  /** Payments that no invoice has used, in minor units. */
  readonly credit: number;
  /** Scans that were not duplicates, by the gym's calendar. */
  readonly visitsThisMonth: number;
  readonly visitsLastMonth: number;
  /** What was paid towards the invoice whose cycle holds today, in minor units. */
  readonly totalPaid: number;
}

/** One row of the list, with the name the page order and the cursor are built on. */
export interface MemberListRow {
  readonly member: MemberView;
  readonly sortName: string;
}
