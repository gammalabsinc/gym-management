import { StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { COLORS, RADII, SPACE } from "./tokens";

const styles = StyleSheet.create({
  skeleton: { height: 16, borderRadius: RADII.control, backgroundColor: COLORS.skeleton },
  block: { alignItems: "center", gap: SPACE.sm, padding: SPACE.xl },
  title: { fontSize: 16, fontWeight: "700", color: COLORS.text },
  body: { fontSize: 14, color: COLORS.textMuted, textAlign: "center" },
});

/** Grey placeholder bars while a query loads. */
export function Skeleton(props: { readonly lines?: number }) {
  const keys = Array.from({ length: props.lines ?? 3 }, (_, line) => `line-${line}`);
  return (
    <View accessibilityLabel="Loading" accessibilityRole="progressbar" style={{ gap: SPACE.sm }}>
      {keys.map((key) => (
        <View key={key} testID="skeleton-line" style={styles.skeleton} />
      ))}
    </View>
  );
}

/** A query that worked and found nothing. */
export function EmptyBlock(props: { readonly title: string; readonly hint?: string }) {
  return (
    <View style={styles.block}>
      <Text style={styles.title}>{props.title}</Text>
      {props.hint === undefined ? null : <Text style={styles.body}>{props.hint}</Text>}
    </View>
  );
}

/** A query that failed. Shows only a mapped message, with a retry when one is given. */
export function ErrorBlock(props: { readonly message: string; readonly onRetry?: () => void }) {
  return (
    <View accessibilityRole="alert" style={styles.block}>
      <Text style={styles.title}>{props.message}</Text>
      {props.onRetry === undefined ? null : (
        <Button label="Try again" kind="secondary" onPress={props.onRetry} />
      )}
    </View>
  );
}
