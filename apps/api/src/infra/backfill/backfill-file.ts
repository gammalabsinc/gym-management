import { z } from "zod";
import type { BackfillMemberInput } from "../../domain/backfill";
import { type ValidationError, validationError } from "../../domain/errors";
import { ok, type Result } from "../../domain/result";

const statusChange = z.strictObject({
  status: z.string(),
  from: z.string(),
  reason: z.string(),
});

const payment = z.strictObject({
  paidOn: z.string(),
  amount: z.number(),
  method: z.string().nullish(),
});

const discount = z.strictObject({
  kind: z.string(),
  amount: z.number(),
  recurring: z.boolean(),
  startsOn: z.string(),
  endsOn: z.string().nullish(),
  reason: z.string().nullish(),
  referralSide: z.string().nullish(),
  sourceEmail: z.string().nullish(),
});

const member = z.strictObject({
  email: z.string(),
  fullName: z.string(),
  phone: z.string().nullish(),
  joinDate: z.string(),
  billingDay: z.number().nullish(),
  statusHistory: z.array(statusChange).default([]),
  payments: z.array(payment).default([]),
  discounts: z.array(discount).default([]),
});

const file = z.strictObject({ members: z.array(member) });

/**
 * Reads the backfill file: JSON with a `members` list. Only the shape is checked here, so a typo
 * in a field name is caught and named. What the values mean is checked by the domain, which also
 * names the member by its place in the list.
 */
export function parseBackfillFile(
  text: string,
): Result<readonly BackfillMemberInput[], ValidationError> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return validationError("Invalid backfill file", [
      { path: [], message: "The file is not valid JSON" },
    ]);
  }
  const parsed = file.safeParse(raw);
  if (parsed.success) return ok(parsed.data.members);
  return validationError(
    "Invalid backfill file",
    parsed.error.issues.map((i) => ({
      path: i.path.filter((part): part is string | number => typeof part !== "symbol"),
      message: i.message,
    })),
  );
}
