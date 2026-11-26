import { act, cleanup, render, renderHook } from "@testing-library/react";
import { createElement, type ReactNode, useContext } from "react";
import { Alert } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmDiscard,
  createUnsavedGuard,
  tabNameOfKey,
  UnsavedGuardContext,
  useUnsavedGuard,
} from "./unsaved";

type Listeners = (args: {
  navigation: { navigate(name: string): void };
  route: { key: string };
}) => { tabPress(event: { target?: string | undefined; preventDefault(): void }): void };

const captured = vi.hoisted(() => ({
  listeners: null as null | Listeners,
  guard: null as null | { setDirty(d: boolean): void },
}));

vi.mock("@react-navigation/bottom-tabs", async () => {
  const react = await import("react");
  const { UnsavedGuardContext: Context } = await import("./unsaved");
  return {
    createBottomTabNavigator: () => ({
      Navigator: (props: { children: ReactNode; screenListeners: Listeners }) => {
        captured.listeners = props.screenListeners;
        captured.guard = react.useContext(Context);
        return react.createElement("div", null, props.children);
      },
      Screen: (props: { name: string; children: () => ReactNode }) =>
        react.createElement("section", { "data-name": props.name }, props.children()),
    }),
  };
});

import { TabSet } from "./TabSet";

afterEach(cleanup);

const realScan = () => createElement("p", null, "Real scan");

function choose(buttons: unknown, index: number): void {
  (buttons as { onPress(): void }[])[index]?.onPress();
}

function press(target: string | undefined, route = "Settings-abc") {
  const navigate = vi.fn();
  const preventDefault = vi.fn();
  captured
    .listeners?.({ navigation: { navigate }, route: { key: route } })
    .tabPress({ target, preventDefault });
  return { navigate, preventDefault };
}

describe("TabSet unsaved changes", () => {
  const tabs = [
    { name: "Scan", title: "Scan" },
    { name: "Settings", title: "Settings" },
  ];

  it("lets a tab press through when nothing is unsaved", () => {
    render(createElement(TabSet, { tabs }));
    expect(press("Scan-xyz").preventDefault).not.toHaveBeenCalled();
  });

  it("lets a press on the current tab through, even with changes", () => {
    render(createElement(TabSet, { tabs }));
    captured.guard?.setDirty(true);
    expect(press("Settings-abc").preventDefault).not.toHaveBeenCalled();
    expect(press(undefined).preventDefault).not.toHaveBeenCalled();
  });

  it("asks before leaving, and stays when the person keeps editing", async () => {
    const alert = vi.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      choose(buttons, 0);
    });
    render(createElement(TabSet, { tabs }));
    captured.guard?.setDirty(true);
    const { navigate, preventDefault } = press("Scan-xyz");
    await act(async () => {});
    expect(preventDefault).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it("leaves when the person discards", async () => {
    const alert = vi.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      choose(buttons, 1);
    });
    render(createElement(TabSet, { tabs }));
    captured.guard?.setDirty(true);
    const { navigate } = press("Scan-xyz");
    await act(async () => {});
    expect(navigate).toHaveBeenCalledWith("Scan");
    alert.mockRestore();
  });

  it("shows the placeholder for a tab without a screen, and the given screen otherwise", () => {
    const view = render(
      createElement(TabSet, {
        tabs,
        screens: { Scan: realScan },
      }),
    );
    expect(view.getByText("Real scan")).toBeTruthy();
    expect(view.getByText("Settings")).toBeTruthy();
  });
});

describe("unsaved helpers", () => {
  it("reads the tab name from a route key", () => {
    expect(tabNameOfKey("Settings-aBc123")).toBe("Settings");
    expect(tabNameOfKey("Plain")).toBe("Plain");
  });

  it("has a working default guard without a provider", () => {
    const { result, unmount } = renderHook(() => {
      useUnsavedGuard(true);
      return useContext(UnsavedGuardContext);
    });
    expect(result.current.isDirty()).toBe(true);
    unmount();
    expect(result.current.isDirty()).toBe(false);
  });

  it("creates independent guards", () => {
    const a = createUnsavedGuard();
    const b = createUnsavedGuard();
    a.setDirty(true);
    expect(b.isDirty()).toBe(false);
  });

  it("resolves the confirmation from the alert buttons", async () => {
    const alert = vi.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
      choose(buttons, 1);
    });
    expect(await confirmDiscard()).toBe(true);
    alert.mockRestore();
  });
});
