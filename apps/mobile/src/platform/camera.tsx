import { CameraView, useCameraPermissions } from "expo-camera";
import { Linking, StyleSheet } from "react-native";
import type { CameraPermission, CameraPort } from "../scanner/camera";

const styles = StyleSheet.create({ camera: { width: 280, height: 280, borderRadius: 14 } });

function permissionOf(
  permission: { granted: boolean; canAskAgain: boolean } | null,
): CameraPermission {
  if (permission === null) return "loading";
  if (permission.granted) return "granted";
  return permission.canAskAgain ? "undetermined" : "denied";
}

/** Reads QR codes only, and none while paused. The camera is released when the view unmounts. */
export const nativeCamera: CameraPort = {
  usePermission() {
    const [permission, request] = useCameraPermissions();
    return { status: permissionOf(permission), request: () => void request() };
  },
  Scanner(props) {
    return (
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={props.paused ? undefined : (result) => props.onScan(result.data)}
      />
    );
  },
  openSettings: () => Linking.openSettings(),
};
