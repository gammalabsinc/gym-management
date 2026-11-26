import { StyleSheet, Text, View } from "react-native";
import type { BuildProfile } from "./build-config";

const styles = StyleSheet.create({
  bar: { backgroundColor: "#B45309", paddingVertical: 2, alignItems: "center" },
  label: { color: "#FFFFFF", fontSize: 11, fontWeight: "700", letterSpacing: 1 },
});

/** A visible marker so an internal build is never mistaken for the store release. */
export function ProfileMarker(props: { readonly profile: BuildProfile }) {
  if (props.profile !== "internal") return null;
  return (
    <View style={styles.bar} testID="profile-marker">
      <Text style={styles.label}>INTERNAL</Text>
    </View>
  );
}
