import { describe, expect, it } from "vitest";
import { ADMIN_TABS, adminTabsFor, CUSTOMER_TABS, OWNER_TABS } from "./tabs";

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

  it("gives owners Settings and Staff and staff neither", () => {
    expect(adminTabsFor("owner")).toBe(OWNER_TABS);
    expect(adminTabsFor("staff")).toBe(ADMIN_TABS);
    expect(OWNER_TABS.map((tab) => tab.name)).toEqual(["Scan", "Customers", "Settings", "Staff"]);
    expect(ADMIN_TABS.map((tab) => tab.name)).not.toContain("Settings");
    expect(ADMIN_TABS.map((tab) => tab.name)).not.toContain("Staff");
  });
});
