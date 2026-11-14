import { describe, expect, it } from "vitest";
import { ADMIN_TABS, CUSTOMER_TABS } from "./tabs";

describe("tab sets", () => {
  it("gives each set unique tab names", () => {
    for (const tabs of [CUSTOMER_TABS, ADMIN_TABS]) {
      expect(new Set(tabs.map((tab) => tab.name)).size).toBe(tabs.length);
    }
  });

  it("keeps the customer and admin sets apart", () => {
    const customer = new Set(CUSTOMER_TABS.map((tab) => tab.name));
    expect(ADMIN_TABS.some((tab) => customer.has(tab.name))).toBe(false);
  });
});
