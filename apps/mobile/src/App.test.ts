import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("expo-status-bar", () => ({ StatusBar: () => null }));
const cameraFake = { usePermission: vi.fn(), Scanner: vi.fn(), openSettings: vi.fn() };

const platform = {
  secureStore: {
    getItemAsync: vi.fn(async () => null),
    setItemAsync: vi.fn(async () => undefined),
    deleteItemAsync: vi.fn(async () => undefined),
  },
  accessible: 1,
  google: { configure: vi.fn(), signIn: vi.fn(), signOut: vi.fn(async () => undefined) },
  storage: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
  camera: cameraFake,
  brightness: {
    getBrightnessAsync: vi.fn(async () => 0.5),
    setBrightnessAsync: vi.fn(async () => undefined),
  },
};

vi.mock("./navigation/RootNavigator", () => ({
  RootNavigator: (props: { session: { status: string } }) =>
    createElement("div", { "data-testid": "root" }, props.session.status),
}));

afterEach(cleanup);

const valid = {
  expoConfig: { extra: { profile: "development", apiUrl: "http://localhost:3000" } },
};

describe("App", () => {
  it("starts signed out when the config is valid and nothing is stored", async () => {
    render(createElement(App, { constants: valid, platform }));
    expect(screen.queryByTestId("root")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("root").textContent).toBe("signedOut"));
  });

  it("restores a kept session before showing anything", async () => {
    platform.secureStore.getItemAsync.mockResolvedValueOnce("kept" as never);
    render(createElement(App, { constants: valid, platform }));
    await waitFor(() => expect(screen.getByTestId("root").textContent).toBe("identity"));
  });

  it("stops waiting for the restore after it unmounts", async () => {
    const view = render(createElement(App, { constants: valid, platform }));
    view.unmount();
    await Promise.resolve();
  });

  it("shows the configuration problem instead of crashing", () => {
    render(
      createElement(App, { constants: { expoConfig: { extra: { profile: "qa" } } }, platform }),
    );
    expect(screen.getByText(/BUILD_PROFILE: must be one of/)).toBeTruthy();
  });

  it("rethrows errors that are not configuration problems", () => {
    const broken = {
      get expoConfig(): never {
        throw new TypeError("boom");
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(createElement(App, { constants: broken, platform }))).toThrow(TypeError);
  });
});
