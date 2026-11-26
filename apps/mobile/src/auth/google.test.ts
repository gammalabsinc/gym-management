import { describe, expect, it, vi } from "vitest";
import { createGoogleSignIn, type GoogleSigninLike } from "./google";

type Response = Awaited<ReturnType<GoogleSigninLike["signIn"]>>;

function lib(response: Response | Error) {
  return {
    configure: vi.fn(),
    signIn: vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    }),
    signOut: vi.fn(async () => undefined),
  };
}

const IDS = { ios: "ios-id", android: "android-id" };

describe("google sign in", () => {
  it("returns the id token and configures once", async () => {
    const google = lib({ type: "success", data: { idToken: "tok" } });
    const port = createGoogleSignIn(google, IDS);
    expect(await port.signIn()).toEqual({ status: "success", idToken: "tok" });
    await port.signIn();
    expect(google.configure).toHaveBeenCalledTimes(1);
    expect(google.configure).toHaveBeenCalledWith({
      iosClientId: "ios-id",
      webClientId: "android-id",
    });
  });

  it("maps cancel to cancelled", async () => {
    const port = createGoogleSignIn(lib({ type: "cancelled", data: null }), IDS);
    expect(await port.signIn()).toEqual({ status: "cancelled" });
  });

  it("fails on a missing or empty token", async () => {
    for (const idToken of [null, ""]) {
      const port = createGoogleSignIn(lib({ type: "success", data: { idToken } }), IDS);
      expect(await port.signIn()).toEqual({ status: "failed" });
    }
  });

  it("fails when the library throws", async () => {
    const port = createGoogleSignIn(lib(new Error("play services")), IDS);
    expect(await port.signIn()).toEqual({ status: "failed" });
  });

  it("fails without client ids and never calls the library", async () => {
    const google = lib({ type: "cancelled", data: null });
    const port = createGoogleSignIn(google, null);
    expect(await port.signIn()).toEqual({ status: "failed" });
    expect(google.signIn).not.toHaveBeenCalled();
  });

  it("signs out only after it was configured, and ignores library errors", async () => {
    const google = lib({ type: "success", data: { idToken: "t" } });
    const port = createGoogleSignIn(google, IDS);
    await port.signOut();
    expect(google.signOut).not.toHaveBeenCalled();
    await port.signIn();
    await port.signOut();
    expect(google.signOut).toHaveBeenCalledTimes(1);
    google.signOut.mockRejectedValueOnce(new Error("x"));
    await expect(port.signOut()).resolves.toBeUndefined();
  });
});
