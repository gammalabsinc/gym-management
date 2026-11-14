import { describe, expect, it } from "vitest";
import { andThen, err, mapResult, ok } from "./result";

describe("Result", () => {
  it("ok and err build tagged values", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err("bad")).toEqual({ ok: false, error: "bad" });
  });

  it("mapResult maps a success and passes a failure through untouched", () => {
    expect(mapResult(ok(2), (n) => n * 2)).toEqual(ok(4));
    const failure = err("bad");
    expect(mapResult(failure, () => 1)).toBe(failure);
  });

  it("andThen chains a success and short circuits on failure", () => {
    expect(andThen(ok(2), (n) => ok(n + 1))).toEqual(ok(3));
    expect(andThen(ok(2), () => err("nope"))).toEqual(err("nope"));
    const failure = err("bad");
    let called = false;
    const result = andThen(failure, () => {
      called = true;
      return ok(1);
    });
    expect(result).toBe(failure);
    expect(called).toBe(false);
  });
});
