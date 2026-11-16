import { type FieldIssue, type ValidationError, validationError } from "./errors";
import { ok, type Result } from "./result";

/** Upper bounds that keep a typo from turning a warning window into years. */
export const MAX_SETTING_DAYS = 366;
export const MAX_SETTING_MINUTES = 1440;
/** Amounts are 32 bit integers in minor units. */
export const MAX_SETTING_AMOUNT = 2_147_483_647;

export interface TenantSettings {
  readonly warnDaysBefore: number;
  readonly redDaysAfter: number;
  readonly dupWindowMin: number;
  readonly referrerAmount: number;
  readonly referrerIsRecurring: boolean;
  readonly referredAmount: number;
  readonly referredIsRecurring: boolean;
}

/** The values a gym has until its owner changes them. Referral rewards start switched off. */
export const DEFAULT_SETTINGS: TenantSettings = {
  warnDaysBefore: 5,
  redDaysAfter: 5,
  dupWindowMin: 10,
  referrerAmount: 0,
  referrerIsRecurring: false,
  referredAmount: 0,
  referredIsRecurring: false,
};

export type SettingKey = keyof TenantSettings;

/** The settings in the order the screen shows them, and the jsonb key each is stored under. */
export const SETTING_COLUMNS = {
  warnDaysBefore: "warn_days_before",
  redDaysAfter: "red_days_after",
  dupWindowMin: "dup_window_min",
  referrerAmount: "referrer_amount",
  referrerIsRecurring: "referrer_is_recurring",
  referredAmount: "referred_amount",
  referredIsRecurring: "referred_is_recurring",
} as const satisfies Record<SettingKey, string>;

const SETTING_KEYS: readonly SettingKey[] = [
  "warnDaysBefore",
  "redDaysAfter",
  "dupWindowMin",
  "referrerAmount",
  "referrerIsRecurring",
  "referredAmount",
  "referredIsRecurring",
];

/** What the owner sends: any setting left out or null stays as it is. */
export interface SettingsPatchInput {
  readonly warnDaysBefore?: number | null | undefined;
  readonly redDaysAfter?: number | null | undefined;
  readonly dupWindowMin?: number | null | undefined;
  readonly referrerAmount?: number | null | undefined;
  readonly referrerIsRecurring?: boolean | null | undefined;
  readonly referredAmount?: number | null | undefined;
  readonly referredIsRecurring?: boolean | null | undefined;
}

export type SettingsPatch = Readonly<Partial<TenantSettings>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function whole(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function countOr(value: unknown, max: number, fallback: number): number {
  return whole(value, max) ? value : fallback;
}

function flagOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Reads the settings column. A key that is missing or out of range falls back to its default. */
export function settingsFromJson(raw: unknown): TenantSettings {
  const json = isRecord(raw) ? raw : {};
  return {
    warnDaysBefore: countOr(
      json.warn_days_before,
      MAX_SETTING_DAYS,
      DEFAULT_SETTINGS.warnDaysBefore,
    ),
    redDaysAfter: countOr(json.red_days_after, MAX_SETTING_DAYS, DEFAULT_SETTINGS.redDaysAfter),
    dupWindowMin: countOr(json.dup_window_min, MAX_SETTING_MINUTES, DEFAULT_SETTINGS.dupWindowMin),
    referrerAmount: countOr(
      json.referrer_amount,
      MAX_SETTING_AMOUNT,
      DEFAULT_SETTINGS.referrerAmount,
    ),
    referrerIsRecurring: flagOr(json.referrer_is_recurring, DEFAULT_SETTINGS.referrerIsRecurring),
    referredAmount: countOr(
      json.referred_amount,
      MAX_SETTING_AMOUNT,
      DEFAULT_SETTINGS.referredAmount,
    ),
    referredIsRecurring: flagOr(json.referred_is_recurring, DEFAULT_SETTINGS.referredIsRecurring),
  };
}

/** The jsonb keys for the settings in a patch, ready to merge into the column. */
export function settingsToJson(patch: SettingsPatch): Record<string, number | boolean> {
  const json: Record<string, number | boolean> = {};
  for (const key of SETTING_KEYS) {
    const value = patch[key];
    if (value !== undefined) json[SETTING_COLUMNS[key]] = value;
  }
  return json;
}

function defined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Checks a settings update. Days, minutes and amounts are whole numbers from zero up to a bound,
 * so an amount can never be negative. A value that is null or left out is not part of the patch.
 */
export function parseSettingsPatch(
  input: SettingsPatchInput,
): Result<SettingsPatch, ValidationError> {
  const issues: FieldIssue[] = [];
  const count = (field: SettingKey, value: number | null | undefined, max: number) => {
    if (!defined(value)) return undefined;
    if (whole(value, max)) return value;
    issues.push({ path: [field], message: `Must be a whole number from 0 to ${max}` });
    return undefined;
  };
  const warn = count("warnDaysBefore", input.warnDaysBefore, MAX_SETTING_DAYS);
  const red = count("redDaysAfter", input.redDaysAfter, MAX_SETTING_DAYS);
  const dup = count("dupWindowMin", input.dupWindowMin, MAX_SETTING_MINUTES);
  const referrer = count("referrerAmount", input.referrerAmount, MAX_SETTING_AMOUNT);
  const referred = count("referredAmount", input.referredAmount, MAX_SETTING_AMOUNT);
  if (issues.length > 0) return validationError("Invalid settings", issues);
  const referrerIsRecurring = input.referrerIsRecurring;
  const referredIsRecurring = input.referredIsRecurring;
  return ok({
    ...(defined(warn) ? { warnDaysBefore: warn } : {}),
    ...(defined(red) ? { redDaysAfter: red } : {}),
    ...(defined(dup) ? { dupWindowMin: dup } : {}),
    ...(defined(referrer) ? { referrerAmount: referrer } : {}),
    ...(defined(referrerIsRecurring) ? { referrerIsRecurring } : {}),
    ...(defined(referred) ? { referredAmount: referred } : {}),
    ...(defined(referredIsRecurring) ? { referredIsRecurring } : {}),
  });
}

export interface SettingsChange {
  readonly settings: TenantSettings;
  /** Only the settings whose value is different, as they were and as they are now. */
  readonly before: Readonly<Record<string, number | boolean>>;
  readonly after: Readonly<Record<string, number | boolean>>;
}

/** Applies a patch. Returns null when it would change nothing. */
export function applySettings(
  current: TenantSettings,
  patch: SettingsPatch,
): SettingsChange | null {
  const before: Record<string, number | boolean> = {};
  const after: Record<string, number | boolean> = {};
  for (const key of SETTING_KEYS) {
    const value = patch[key];
    if (value !== undefined && value !== current[key]) {
      before[key] = current[key];
      after[key] = value;
    }
  }
  if (Object.keys(after).length === 0) return null;
  return { settings: { ...current, ...patch }, before, after };
}

export interface Branding {
  readonly logoUrl: string | null;
  readonly primaryColor: string | null;
  readonly contactPhone: string | null;
  readonly contactEmail: string | null;
  readonly contactAddress: string | null;
}

/** Reads the branding column: logo_url, primary_color and a contact object. Missing is null. */
export function brandingFromJson(raw: unknown): Branding {
  const json = isRecord(raw) ? raw : {};
  const contact = isRecord(json.contact) ? json.contact : {};
  return {
    logoUrl: text(json.logo_url),
    primaryColor: text(json.primary_color),
    contactPhone: text(contact.phone),
    contactEmail: text(contact.email),
    contactAddress: text(contact.address),
  };
}

export interface Tenant {
  readonly id: string;
  readonly name: string;
  readonly subdomain: string;
  readonly timezone: string;
  readonly currency: string;
  readonly branding: Branding;
  readonly settings: TenantSettings;
}

/** What a member may read about their gym: the name, the colour and how to reach it. */
export interface MemberTenantView {
  readonly id: string;
  readonly name: string;
  readonly branding: Pick<
    Branding,
    "primaryColor" | "contactPhone" | "contactEmail" | "contactAddress"
  >;
}

export function toMemberView(tenant: Tenant): MemberTenantView {
  const { primaryColor, contactPhone, contactEmail, contactAddress } = tenant.branding;
  return {
    id: tenant.id,
    name: tenant.name,
    branding: { primaryColor, contactPhone, contactEmail, contactAddress },
  };
}
