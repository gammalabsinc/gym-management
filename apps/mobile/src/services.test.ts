import { describe, expect, it, vi } from "vitest";
import type { RuntimeConfig } from "./config/build-config";
import { composeServices, newRequestId, type Platform } from "./services";

const config = {
  profile: "development",
  apiUrl: "http://api.test",
  googleClientIds: null,
} as unknown as RuntimeConfig;

function platform(): Platform {
  return {
    secureStore: {
      getItemAsync: vi.fn(async () => "kept"),
      setItemAsync: vi.fn(async () => undefined),
      deleteItemAsync: vi.fn(async () => undefined),
    },
    accessible: 3,
    google: { configure: vi.fn(), signIn: vi.fn(), signOut: vi.fn(async () => undefined) },
    storage: {
      getItem: vi.fn(async () => null),
      setItem: vi.fn(async () => undefined),
      removeItem: vi.fn(async () => undefined),
    },
    camera: { usePermission: vi.fn(), Scanner: vi.fn(), openSettings: vi.fn() },
    brightness: {
      getBrightnessAsync: vi.fn(async () => 0.4),
      setBrightnessAsync: vi.fn(async () => undefined),
    },
  };
}

describe("composeServices", () => {
  it("restores a kept token into the session", async () => {
    const s = composeServices(config, platform(), vi.fn());
    await s.auth.restore();
    expect(s.store.getSession()).toEqual({ status: "identity" });
  });

  it("signs out the device when the api says the session is gone", async () => {
    const p = platform();
    const unauthorized = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ errors: [{ message: "x", extensions: { code: "UNAUTHENTICATED" } }] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    const s = composeServices(config, p, unauthorized as unknown as typeof fetch);
    await s.auth.restore();
    await s.auth.signOut();
    expect(s.store.getSession().status).toBe("signedOut");
    expect(p.secureStore.deleteItemAsync).toHaveBeenCalled();
  });

  it("drops the cached card when the session is no longer bound to a gym", async () => {
    const p = platform();
    const s = composeServices(config, p, vi.fn());
    s.store.signInIdentity("t");
    const before = vi.mocked(p.storage.removeItem).mock.calls.length;
    s.store.enterGym("member", "t1");
    expect(p.storage.removeItem).toHaveBeenCalledTimes(before);
    s.store.leaveGym();
    expect(p.storage.removeItem).toHaveBeenCalledTimes(before + 1);
    s.store.signOut();
    expect(p.storage.removeItem).toHaveBeenCalledTimes(before + 2);
  });

  it("makes distinct request ids", () => {
    expect(newRequestId()).not.toBe(newRequestId());
  });
});
