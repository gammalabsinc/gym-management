import type { ReactNode } from "react";

export type CameraPermission = "loading" | "undetermined" | "granted" | "denied";

/** The camera, as the scanner needs it. The real one wraps expo-camera, tests pass a fake. */
export interface CameraPort {
  usePermission(): { readonly status: CameraPermission; readonly request: () => void };
  /** Shows the camera and reports each code it reads. Reports nothing while `paused`. */
  Scanner(props: { readonly paused: boolean; readonly onScan: (value: string) => void }): ReactNode;
  /** The native path to this app's settings page. */
  openSettings(): Promise<void>;
}
