import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SIGNED_OUT } from "../auth/session";

// The navigation libraries need the native runtime. Replace them with plain wrappers,
// so these tests cover our own gate and tab wiring.
vi.mock("../screens/GymPicker", () => ({
  GymPicker: () => createElement("div", null, "Pick a gym"),
}));
vi.mock("../screens/SignIn", () => ({
  SignIn: () => createElement("div", null, "Sign in screen"),
}));
vi.mock("@react-navigation/native", () => ({
  NavigationContainer: (props: { children: ReactNode }) =>
    createElement("div", { "data-testid": "nav" }, props.children),
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaProvider: (props: { children: ReactNode }) => createElement("div", null, props.children),
}));
vi.mock("@react-navigation/bottom-tabs", () => {
  const Screen = (props: { name: string; children: () => ReactNode }) =>
    createElement("section", { "data-testid": `tab-${props.name}` }, props.children());
  const Navigator = (props: { children: ReactNode }) =>
    createElement("div", { "data-testid": "tabs" }, props.children);
  return { createBottomTabNavigator: () => ({ Navigator, Screen }) };
});

afterEach(cleanup);

let RootNavigator: typeof import("./RootNavigator").RootNavigator;

beforeAll(async () => {
  ({ RootNavigator } = await import("./RootNavigator"));
});

describe("RootNavigator", () => {
  it("shows sign in when signed out", () => {
    render(createElement(RootNavigator, { session: SIGNED_OUT }));
    expect(screen.getByText("Sign in screen")).toBeTruthy();
    expect(screen.queryByTestId("tabs")).toBeNull();
  });

  it("shows the gym picker after Google sign in", () => {
    render(createElement(RootNavigator, { session: { status: "identity" } }));
    expect(screen.getByText("Pick a gym")).toBeTruthy();
  });

  it("shows the customer tabs for a member", () => {
    render(createElement(RootNavigator, { session: { status: "signedIn", role: "member" } }));
    expect(screen.getByTestId("tab-Card")).toBeTruthy();
    expect(screen.getByTestId("tab-Visits")).toBeTruthy();
    expect(screen.queryByTestId("tab-Scan")).toBeNull();
  });

  it("shows the admin tabs for staff", () => {
    render(createElement(RootNavigator, { session: { status: "signedIn", role: "staff" } }));
    expect(screen.getByTestId("tab-Scan")).toBeTruthy();
    expect(screen.getByTestId("tab-Customers")).toBeTruthy();
    expect(screen.queryByTestId("tab-Card")).toBeNull();
  });

  it("gives an owner the Settings and Staff tabs and staff neither", () => {
    render(createElement(RootNavigator, { session: { status: "signedIn", role: "owner" } }));
    expect(screen.getByTestId("tab-Settings")).toBeTruthy();
    expect(screen.getByTestId("tab-Staff")).toBeTruthy();
    cleanup();
    render(createElement(RootNavigator, { session: { status: "signedIn", role: "staff" } }));
    expect(screen.queryByTestId("tab-Settings")).toBeNull();
    expect(screen.queryByTestId("tab-Staff")).toBeNull();
  });
});
