import { describe, expect, it, vi } from "vitest";
import { forbidden } from "../domain/errors";
import type { Role } from "../domain/permissions";
import { err, ok } from "../domain/result";
import { denyUnguarded, isGuarded, requirePermission } from "./require-permission";

const ctxOf = (...roles: Role[]) => ({ roles });

describe("requirePermission", () => {
  it("runs the use case for a caller who holds the permission", async () => {
    const useCase = vi.fn(async (input: number) => ok(input + 1));
    const guarded = requirePermission("payment.record", useCase);
    expect(await guarded(1, ctxOf("staff"))).toEqual(ok(2));
    expect(useCase).toHaveBeenCalledWith(1, ctxOf("staff"));
  });

  it("passes a use case failure through unchanged", async () => {
    const failure = err({ kind: "conflict" as const, message: "Already there" });
    const guarded = requirePermission("payment.record", async () => failure);
    expect(await guarded(undefined, ctxOf("owner"))).toEqual(failure);
  });

  it("refuses a caller who lacks the permission, without calling the use case", async () => {
    const useCase = vi.fn(async () => ok("done"));
    const guarded = requirePermission("role.manage", useCase);
    expect(await guarded(undefined, ctxOf("staff"))).toEqual(forbidden());
    expect(useCase).not.toHaveBeenCalled();
  });

  it("refuses a caller with no roles", async () => {
    const guarded = requirePermission("scan.record", async () => ok("done"));
    expect(await guarded(undefined, ctxOf())).toEqual(forbidden());
  });

  it("reports the permission it requires", () => {
    const guarded = requirePermission("plan.manage", async () => ok(null));
    expect(guarded.requiredPermission).toBe("plan.manage");
  });

  it("follows the permission table, so a staff grant needs no change here", async () => {
    const guarded = requirePermission("member.create", async () => ok("created"));
    expect(await guarded(undefined, ctxOf("staff"))).toEqual(ok("created"));
  });
});

describe("isGuarded", () => {
  it("is true for a wrapped use case and false for a plain one", () => {
    const plain = async () => ok(1);
    expect(isGuarded(plain)).toBe(false);
    expect(isGuarded(requirePermission("scan.record", plain))).toBe(true);
  });
});

describe("denyUnguarded", () => {
  it("denies an unguarded use case, even for an owner, and never calls it", async () => {
    const useCase = vi.fn(async () => ok("done"));
    const result = await denyUnguarded(useCase)(undefined, ctxOf("owner"));
    expect(result).toEqual(forbidden());
    expect(useCase).not.toHaveBeenCalled();
  });

  it("keeps a guarded use case as it is", async () => {
    const guarded = requirePermission("scan.record", async () => ok("done"));
    expect(denyUnguarded(guarded)).toBe(guarded);
    expect(await denyUnguarded(guarded)(undefined, ctxOf("staff"))).toEqual(ok("done"));
  });
});
