import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("expo-status-bar", () => ({ StatusBar: () => null }));
vi.mock("./navigation/RootNavigator", () => ({
  RootNavigator: (props: { session: { status: string } }) =>
    createElement("div", { "data-testid": "root" }, props.session.status),
}));

afterEach(cleanup);

const valid = {
  expoConfig: { extra: { profile: "development", apiUrl: "http://localhost:3000" } },
};

describe("App", () => {
  it("starts signed out when the config is valid", () => {
    render(createElement(App, { constants: valid }));
    expect(screen.getByTestId("root").textContent).toBe("signedOut");
  });

  it("shows the configuration problem instead of crashing", () => {
    render(createElement(App, { constants: { expoConfig: { extra: { profile: "qa" } } } }));
    expect(screen.getByText(/BUILD_PROFILE: must be one of/)).toBeTruthy();
  });

  it("rethrows errors that are not configuration problems", () => {
    const broken = {
      get expoConfig(): never {
        throw new TypeError("boom");
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(createElement(App, { constants: broken }))).toThrow(TypeError);
  });
});
