import { describe, expect, it } from "vitest";
import type { TenantTx } from "./tenant-tx";
import { makeTxExecutor } from "./tx-executor";

describe("makeTxExecutor", () => {
  it("refuses a handle that did not come from withTenantTx", () => {
    const foreign = { tenantId: "t", manager: { query: async () => [] } } as unknown as TenantTx;
    expect(() => makeTxExecutor(foreign)).toThrow("withTenantTx");
  });
});
