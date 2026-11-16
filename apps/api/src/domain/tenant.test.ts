import { describe, expect, it } from "vitest";
import {
  applySettings,
  brandingFromJson,
  DEFAULT_SETTINGS,
  MAX_SETTING_AMOUNT,
  MAX_SETTING_DAYS,
  MAX_SETTING_MINUTES,
  parseSettingsPatch,
  settingsFromJson,
  settingsToJson,
  type Tenant,
  toMemberView,
} from "./tenant";

describe("settingsFromJson", () => {
  it("reads every key of the column", () => {
    expect(
      settingsFromJson({
        warn_days_before: 7,
        red_days_after: 3,
        dup_window_min: 20,
        referrer_amount: 500,
        referrer_is_recurring: true,
        referred_amount: 250,
        referred_is_recurring: true,
      }),
    ).toEqual({
      warnDaysBefore: 7,
      redDaysAfter: 3,
      dupWindowMin: 20,
      referrerAmount: 500,
      referrerIsRecurring: true,
      referredAmount: 250,
      referredIsRecurring: true,
    });
  });

  it("falls back to the defaults for a missing, wrong or out of range key", () => {
    expect(settingsFromJson({})).toEqual(DEFAULT_SETTINGS);
    expect(settingsFromJson(null)).toEqual(DEFAULT_SETTINGS);
    expect(settingsFromJson([1, 2])).toEqual(DEFAULT_SETTINGS);
    expect(
      settingsFromJson({
        warn_days_before: -1,
        red_days_after: MAX_SETTING_DAYS + 1,
        dup_window_min: 1.5,
        referrer_amount: "10",
        referrer_is_recurring: "yes",
        referred_amount: MAX_SETTING_AMOUNT + 1,
        referred_is_recurring: 1,
      }),
    ).toEqual(DEFAULT_SETTINGS);
  });
});

describe("parseSettingsPatch", () => {
  it("keeps what was sent and drops null and missing values", () => {
    expect(
      parseSettingsPatch({
        warnDaysBefore: 0,
        redDaysAfter: null,
        dupWindowMin: MAX_SETTING_MINUTES,
        referrerAmount: 100,
        referrerIsRecurring: false,
        referredAmount: undefined,
        referredIsRecurring: true,
      }),
    ).toEqual({
      ok: true,
      value: {
        warnDaysBefore: 0,
        dupWindowMin: MAX_SETTING_MINUTES,
        referrerAmount: 100,
        referrerIsRecurring: false,
        referredIsRecurring: true,
      },
    });
  });

  it("accepts an empty patch and the highest allowed values", () => {
    expect(parseSettingsPatch({})).toEqual({ ok: true, value: {} });
    expect(
      parseSettingsPatch({
        warnDaysBefore: MAX_SETTING_DAYS,
        redDaysAfter: MAX_SETTING_DAYS,
        referrerAmount: MAX_SETTING_AMOUNT,
        referredAmount: MAX_SETTING_AMOUNT,
      }).ok,
    ).toBe(true);
  });

  it("refuses negative amounts, fractions and values above the bounds, all at once", () => {
    const result = parseSettingsPatch({
      warnDaysBefore: MAX_SETTING_DAYS + 1,
      redDaysAfter: -1,
      dupWindowMin: MAX_SETTING_MINUTES + 1,
      referrerAmount: -100,
      referredAmount: 1.5,
    });
    expect(!result.ok && result.error.issues.map((issue) => issue.path[0])).toEqual([
      "warnDaysBefore",
      "redDaysAfter",
      "dupWindowMin",
      "referrerAmount",
      "referredAmount",
    ]);
  });
});

describe("applySettings", () => {
  it("reports only the settings that differ, before and after", () => {
    const change = applySettings(DEFAULT_SETTINGS, {
      warnDaysBefore: 5,
      redDaysAfter: 9,
      referrerIsRecurring: true,
    });
    expect(change).toEqual({
      settings: { ...DEFAULT_SETTINGS, redDaysAfter: 9, referrerIsRecurring: true },
      before: { redDaysAfter: 5, referrerIsRecurring: false },
      after: { redDaysAfter: 9, referrerIsRecurring: true },
    });
  });

  it("is null when nothing would change", () => {
    expect(applySettings(DEFAULT_SETTINGS, {})).toBeNull();
    expect(applySettings(DEFAULT_SETTINGS, { dupWindowMin: 10 })).toBeNull();
  });
});

describe("settingsToJson", () => {
  it("uses the jsonb keys and skips settings that are not in the patch", () => {
    expect(settingsToJson({ warnDaysBefore: 7, referredIsRecurring: true })).toEqual({
      warn_days_before: 7,
      referred_is_recurring: true,
    });
    expect(settingsToJson({})).toEqual({});
  });
});

describe("brandingFromJson", () => {
  it("reads the logo, colour and contact object", () => {
    expect(
      brandingFromJson({
        logo_url: "https://x.test/logo.png",
        primary_color: "#112233",
        contact: { phone: "555", email: "hi@x.test", address: "1 Main St" },
      }),
    ).toEqual({
      logoUrl: "https://x.test/logo.png",
      primaryColor: "#112233",
      contactPhone: "555",
      contactEmail: "hi@x.test",
      contactAddress: "1 Main St",
    });
  });

  it("turns anything missing, blank or of the wrong type into null", () => {
    const empty = {
      logoUrl: null,
      primaryColor: null,
      contactPhone: null,
      contactEmail: null,
      contactAddress: null,
    };
    expect(brandingFromJson({})).toEqual(empty);
    expect(brandingFromJson(undefined)).toEqual(empty);
    expect(brandingFromJson({ logo_url: "  ", primary_color: 5, contact: "no" })).toEqual(empty);
  });
});

describe("toMemberView", () => {
  it("keeps the name, colour and contacts and drops everything else", () => {
    const tenant: Tenant = {
      id: "t1",
      name: "Iron Gym",
      subdomain: "iron",
      timezone: "America/Toronto",
      currency: "CAD",
      branding: {
        logoUrl: "https://x.test/logo.png",
        primaryColor: "#112233",
        contactPhone: "555",
        contactEmail: "hi@x.test",
        contactAddress: "1 Main St",
      },
      settings: DEFAULT_SETTINGS,
    };
    expect(toMemberView(tenant)).toEqual({
      id: "t1",
      name: "Iron Gym",
      branding: {
        primaryColor: "#112233",
        contactPhone: "555",
        contactEmail: "hi@x.test",
        contactAddress: "1 Main St",
      },
    });
  });
});
