import { StyleSheet, Text, View } from "react-native";
import { initials } from "./dates";
import { COLORS } from "./tokens";

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center", backgroundColor: COLORS.avatar },
  text: { fontWeight: "700", fontSize: 14, color: COLORS.text },
});

/** Initials on a neutral circle. Decorative, so the name next to it is what a screen reader reads. */
export function Avatar(props: {
  readonly name?: string | null;
  readonly email?: string;
  readonly size?: number;
}) {
  const size = props.size ?? 40;
  return (
    <View
      testID="avatar"
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <Text style={styles.text}>{initials(props.name, props.email)}</Text>
    </View>
  );
}
