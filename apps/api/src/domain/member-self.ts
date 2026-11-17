import { localTimeIn } from "./calendar";
import type { MemberView } from "./member-view";
import type { MembershipStatus, Standing } from "./standing";
import type { MemberTenantView, Tenant } from "./tenant";
import { toMemberView } from "./tenant";

/** The card the member shows at the door: who they are, their standing and the code to scan. */
export interface MemberCard {
  readonly gym: Pick<MemberTenantView, "name"> & { readonly primaryColor: string | null };
  /** The value the QR code encodes. */
  readonly barcode: string;
  readonly memberNo: string;
  readonly name: string | null;
  readonly standing: Standing;
  /** Active, paused or cancelled, so the card can show paused and cancelled differently. */
  readonly membershipStatus: MembershipStatus;
  readonly paidThrough: string | null;
}

/** What the member may read about themselves. There is no edit, and no ledger or referral data. */
export interface MemberProfile {
  readonly name: string | null;
  readonly email: string;
  readonly planName: string;
  readonly memberNo: string;
  readonly joinedOn: string;
}

/** One visit as the member sees it, in the gym's own day and time. */
export interface MemberVisit {
  readonly id: string;
  /** The gym's calendar day, YYYY-MM-DD. */
  readonly day: string;
  /** The gym's wall clock time, HH:mm. */
  readonly time: string;
}

export interface VisitMonth {
  /** YYYY-MM. */
  readonly month: string;
  readonly visits: readonly MemberVisit[];
}

export function toMemberCard(member: MemberView, tenant: Tenant): MemberCard {
  const gym = toMemberView(tenant);
  return {
    gym: { name: gym.name, primaryColor: gym.branding.primaryColor },
    barcode: member.barcode,
    memberNo: member.memberNo,
    name: member.name,
    standing: member.standing,
    membershipStatus: member.status,
    paidThrough: member.paidThrough,
  };
}

export function toMemberProfile(member: MemberView): MemberProfile {
  return {
    name: member.name,
    email: member.email,
    planName: member.plan.name,
    memberNo: member.memberNo,
    joinedOn: member.joinedOn,
  };
}

interface ScanLike {
  readonly id: string;
  readonly scannedAt: string;
  readonly localDate: string;
}

/**
 * Groups visits, newest first, into the gym's calendar months. Rows arrive newest first, so the
 * months do too. The day comes from the stored gym day and the time from the instant in the gym's
 * zone, so a late evening scan stays on the day it happened for the member.
 */
export function groupVisitsByMonth(
  scans: readonly ScanLike[],
  timeZone: string,
): readonly VisitMonth[] {
  const months: { month: string; visits: MemberVisit[] }[] = [];
  for (const scan of scans) {
    const month = scan.localDate.slice(0, 7);
    const visit: MemberVisit = {
      id: scan.id,
      day: scan.localDate,
      time: localTimeIn(Date.parse(scan.scannedAt), timeZone),
    };
    const current = months.at(-1);
    if (current !== undefined && current.month === month) current.visits.push(visit);
    else months.push({ month, visits: [visit] });
  }
  return months;
}
