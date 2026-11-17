import { describe, expect, it } from "vitest";
import type { WithTenantTx } from "../../app/ports";
import { dryRunOf } from "./dry-run";

describe("dryRunOf", () => {
  it("returns what the work returned, though the transaction was rolled back", async () => {
    const rolledBack: string[] = [];
    const withTx: WithTenantTx<string> = async (tenantId, fn) => {
      try {
        return await fn("tx");
      } catch (error) {
        rolledBack.push(tenantId);
        throw error;
      }
    };
    const result = await dryRunOf(withTx)("t1", async (tx) => `${tx} done`);
    expect(result).toBe("tx done");
    expect(rolledBack).toEqual(["t1"]);
  });

  it("lets an error from the work reach the caller", async () => {
    const withTx: WithTenantTx<string> = (_tenantId, fn) => fn("tx");
    await expect(
      dryRunOf(withTx)("t1", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
