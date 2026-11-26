import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "../ui/Button";
import { SPACE } from "../ui/tokens";

const DARK = "#0B0F17";

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: DARK },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: SPACE.xl,
  },
  title: { fontSize: 17, fontWeight: "700", color: "#FFFFFF" },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: SPACE.md, padding: 32 },
  heading: { fontSize: 20, fontWeight: "700", color: "#FFFFFF", textAlign: "center" },
  text: { fontSize: 16, color: "#FFFFFF", opacity: 0.85, textAlign: "center" },
  hint: { fontSize: 17, color: "#FFFFFF", textAlign: "center" },
});

export type ScannerView =
  | { readonly state: "scanning"; readonly camera: ReactNode }
  | { readonly state: "denied" }
  | { readonly state: "offline" }
  /** Waiting for the camera permission answer. */
  | { readonly state: "waiting" };

/** A1: the camera scanner and its states, scanning, camera off, no connection. The result is A1b. */
export function ScannerScreen(props: {
  readonly view: ScannerView;
  readonly onSearch: () => void;
  readonly onOpenSettings: () => void;
  readonly onRetry: () => void;
}) {
  const { view } = props;
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Check in</Text>
        <Button label="Search" kind="secondary" onPress={props.onSearch} />
      </View>
      {view.state === "scanning" ? (
        <View style={styles.body}>
          {view.camera}
          <Text style={styles.hint}>Hold the code inside the frame</Text>
        </View>
      ) : null}
      {view.state === "denied" ? (
        <View accessibilityRole="alert" style={styles.body}>
          <Text style={styles.heading}>Camera is off</Text>
          <Text style={styles.text}>
            Allow camera access for Gym in your phone Settings to scan member codes. You can still
            check people in by name.
          </Text>
          <Button label="Open settings" onPress={props.onOpenSettings} />
          <Button label="Search by name" kind="secondary" onPress={props.onSearch} />
        </View>
      ) : null}
      {view.state === "offline" ? (
        <View accessibilityRole="alert" style={styles.body}>
          <Text style={styles.heading}>No connection</Text>
          <Text style={styles.text}>
            Scans cannot be saved right now. Let members in and check them in once you are back
            online.
          </Text>
          <Button label="Try again" onPress={props.onRetry} />
        </View>
      ) : null}
    </View>
  );
}
