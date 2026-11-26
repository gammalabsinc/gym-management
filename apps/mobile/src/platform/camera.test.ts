import { cleanup, render, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const expo = vi.hoisted(() => ({
  permission: null as null | { granted: boolean; canAskAgain: boolean },
  request: vi.fn(async () => undefined),
  lastProps: null as null | Record<string, unknown>,
}));

vi.mock("expo-camera", () => ({
  useCameraPermissions: () => [expo.permission, expo.request],
  CameraView: (props: Record<string, unknown>) => {
    expo.lastProps = props;
    return null;
  },
}));

import { nativeCamera } from "./camera";

afterEach(cleanup);

describe("native camera", () => {
  it("maps the permission states", () => {
    const cases = [
      [null, "loading"],
      [{ granted: true, canAskAgain: true }, "granted"],
      [{ granted: false, canAskAgain: true }, "undetermined"],
      [{ granted: false, canAskAgain: false }, "denied"],
    ] as const;
    for (const [permission, status] of cases) {
      expo.permission = permission as typeof expo.permission;
      const { result } = renderHook(() => nativeCamera.usePermission());
      expect(result.current.status).toBe(status);
    }
  });

  it("requests the permission", () => {
    const { result } = renderHook(() => nativeCamera.usePermission());
    result.current.request();
    expect(expo.request).toHaveBeenCalled();
  });

  it("reads QR codes and reports their data, until paused", () => {
    const onScan = vi.fn();
    render(createElement(nativeCamera.Scanner, { paused: false, onScan }));
    const read = expo.lastProps?.onBarcodeScanned as (r: { data: string }) => void;
    read({ data: "ABC123" });
    expect(onScan).toHaveBeenCalledWith("ABC123");
    expect(expo.lastProps?.barcodeScannerSettings).toEqual({ barcodeTypes: ["qr"] });
    render(createElement(nativeCamera.Scanner, { paused: true, onScan }));
    expect(expo.lastProps?.onBarcodeScanned).toBeUndefined();
  });

  it("opens the app settings", async () => {
    await expect(nativeCamera.openSettings()).resolves.toBeUndefined();
  });
});
