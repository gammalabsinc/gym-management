import { describe, expect, it } from "vitest";
import { destinationFor, SIGNED_OUT } from "./session";

describe("destinationFor", () => {
  it("sends a signed out user to sign in", () => {
    expect(destinationFor(SIGNED_OUT)).toBe("signIn");
  });

  it("sends a signed in person without a gym to the gym picker", () => {
    expect(destinationFor({ status: "identity" })).toBe("picker");
  });

  it("sends members to the customer tabs", () => {
    expect(destinationFor({ status: "signedIn", role: "member" })).toBe("customer");
  });

  it("sends staff and owners to the admin tabs", () => {
    expect(destinationFor({ status: "signedIn", role: "staff" })).toBe("admin");
    expect(destinationFor({ status: "signedIn", role: "owner" })).toBe("admin");
  });
});
