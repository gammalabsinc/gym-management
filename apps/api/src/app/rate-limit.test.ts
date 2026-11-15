import { describe, expect, it } from "vitest";
import { makeRateLimiter } from "./rate-limit";

function setup(limit = 2, windowMs = 1000) {
  let now = 0;
  const limiter = makeRateLimiter({
    clock: { now: () => new Date(now) },
    policy: { limit, windowMs },
  });
  return { limiter, advance: (ms: number) => (now += ms) };
}

describe("makeRateLimiter", () => {
  it("allows calls up to the limit then blocks with a retry time", () => {
    const { limiter, advance } = setup();
    expect(limiter.take("a")).toEqual({ allowed: true });
    expect(limiter.take("a")).toEqual({ allowed: true });
    advance(250);
    expect(limiter.take("a")).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  it("rounds the retry time up to whole seconds", () => {
    const { limiter } = setup(1, 2500);
    limiter.take("a");
    expect(limiter.take("a")).toEqual({ allowed: false, retryAfterSeconds: 3 });
  });

  it("counts each key on its own", () => {
    const { limiter } = setup(1);
    limiter.take("a");
    expect(limiter.take("b")).toEqual({ allowed: true });
    expect(limiter.take("a").allowed).toBe(false);
  });

  it("opens a fresh window once the old one has expired", () => {
    const { limiter, advance } = setup(1);
    limiter.take("a");
    expect(limiter.take("a").allowed).toBe(false);
    advance(1000);
    expect(limiter.take("a")).toEqual({ allowed: true });
  });

  it("drops expired windows of other keys when a new window starts", () => {
    const { limiter, advance } = setup(1);
    limiter.take("old");
    limiter.take("keep");
    advance(900);
    limiter.take("keep");
    advance(100);
    // "old" expired at 1000, "keep" window still open until 1000 as well; both swept on next start.
    expect(limiter.take("new")).toEqual({ allowed: true });
    expect(limiter.take("old")).toEqual({ allowed: true });
  });
});
