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

  it("makes distinct request ids", () => {
    expect(newRequestId()).not.toBe(newRequestId());
  });
});
