import type { OnboardGymInput } from "./onboarding";
import type { InviteInput } from "./staff";

/**
 * The standing a seeded member ends up in. Paid, due soon and overdue come from the invoices the
 * first cycle writes and from whether it was paid. Paused and cancelled are inactive whatever the
 * invoices say.
 */
export const SEED_SCENARIOS = ["paid", "due_soon", "overdue", "paused", "cancelled"] as const;
export type SeedScenario = (typeof SEED_SCENARIOS)[number];

export interface SeedMember {
  readonly fullName: string;
  readonly email: string;
  readonly phone: string | null;
  /** How many days before today the member joined, in the gym's own calendar. */
  readonly daysSinceJoin: number;
  readonly scenario: SeedScenario;
}

export interface SeedGym {
  readonly gym: OnboardGymInput;
  readonly staff: InviteInput;
  readonly members: readonly SeedMember[];
}

/** Why the seed pauses or cancels a member. The use cases require a reason. */
export const SEED_REASONS = {
  paused: "Seed data: away for the month",
  cancelled: "Seed data: moved out of town",
} as const;

/**
 * The local dataset. The join dates are days before today and not fixed dates, so the standings
 * stay true whenever the seed runs. With the default thresholds (5 days before and 5 days after)
 * a first invoice that fell due 3 days ago is due soon and one that fell due 12 days ago is
 * overdue. Everyone joined less than a month ago, so each member has exactly one invoice.
 */
export const DEV_GYMS: readonly SeedGym[] = [
  {
    gym: {
      name: "Iron Works",
      subdomain: "ironworks",
      timezone: "America/Toronto",
      currency: "CAD",
      ownerEmail: "owner@ironworks.test",
      ownerName: "Olive Owner",
      admissionFee: 5000,
      monthlyFee: 4000,
    },
    staff: { email: "staff@ironworks.test", name: "Sam Staff", role: "staff" },
    members: [
      member("Paula Paid", "paula@ironworks.test", 10, "paid"),
      member("Pedro Paid", "pedro@ironworks.test", 20, "paid"),
      member("Dana Due", "dana@ironworks.test", 3, "due_soon"),
      member("Olga Overdue", "olga@ironworks.test", 12, "overdue"),
      member("Pavel Paused", "pavel@ironworks.test", 20, "paused"),
      member("Carla Cancelled", "carla@ironworks.test", 25, "cancelled"),
    ],
  },
  {
    gym: {
      name: "Pulse Fitness",
      subdomain: "pulsefit",
      timezone: "America/Vancouver",
      currency: "CAD",
      ownerEmail: "owner@pulsefit.test",
      ownerName: "Omar Owner",
      admissionFee: 3000,
      monthlyFee: 3500,
    },
    staff: { email: "staff@pulsefit.test", name: "Sasha Staff", role: "staff" },
    members: [
      member("Peter Paid", "peter@pulsefit.test", 15, "paid"),
      member("Daisy Due", "daisy@pulsefit.test", 4, "due_soon"),
      member("Oscar Overdue", "oscar@pulsefit.test", 14, "overdue"),
      member("Paige Paused", "paige@pulsefit.test", 18, "paused"),
      member("Colin Cancelled", "colin@pulsefit.test", 22, "cancelled"),
    ],
  },
];

function member(
  fullName: string,
  email: string,
  daysSinceJoin: number,
  scenario: SeedScenario,
): SeedMember {
  return { fullName, email, phone: null, daysSinceJoin, scenario };
}
