import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ProfileMarker } from "./ProfileMarker";

afterEach(cleanup);

describe("ProfileMarker", () => {
  it("shows INTERNAL on the internal profile", () => {
    render(createElement(ProfileMarker, { profile: "internal" }));
    expect(screen.getByTestId("profile-marker").textContent).toBe("INTERNAL");
  });

  it.each(["production", "development"] as const)("shows nothing on %s", (profile) => {
    render(createElement(ProfileMarker, { profile }));
    expect(screen.queryByTestId("profile-marker")).toBeNull();
  });
});
