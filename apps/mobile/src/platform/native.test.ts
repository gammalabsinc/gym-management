import { describe, expect, it, vi } from "vitest";

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 6,
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: vi.fn() } }));
vi.mock("expo-camera", () => ({ CameraView: () => null, useCameraPermissions: vi.fn() }));
vi.mock("expo-brightness", () => ({ getBrightnessAsync: vi.fn(), setBrightnessAsync: vi.fn() }));
vi.mock("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: { configure: vi.fn() },
}));

describe("native platform", () => {
  it("keeps the token readable after first unlock, on this device only", async () => {
    const { nativePlatform } = await import("./native");
    expect(nativePlatform.accessible).toBe(6);
    expect(typeof nativePlatform.google.configure).toBe("function");
    expect(typeof nativePlatform.camera.openSettings).toBe("function");
    expect(typeof nativePlatform.storage.getItem).toBe("function");
    expect(typeof nativePlatform.brightness.setBrightnessAsync).toBe("function");
    expect(typeof nativePlatform.secureStore.getItemAsync).toBe("function");
  });
});
