import { describe, expect, it, vi } from "vitest";

const registerRootComponent = vi.hoisted(() => vi.fn());
vi.mock("expo", () => ({ registerRootComponent }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock("./platform/native", () => ({ nativePlatform: "NativeStub" }));
vi.mock("./App", () => ({ App: "AppStub" }));

describe("entry point", () => {
  it("registers the App with the expo constants", async () => {
    await import("../index");
    const factory = registerRootComponent.mock.calls[0]?.[0] as () => {
      type: string;
      props: { constants: unknown; platform: unknown };
    };
    const element = factory();
    expect(element.type).toBe("AppStub");
    expect(element.props.constants).toEqual({ expoConfig: { extra: {} } });
    expect(element.props.platform).toBe("NativeStub");
  });
});
