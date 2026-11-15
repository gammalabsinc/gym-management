import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { COLORS, MIN_TOUCH, RADII, SPACE } from "./tokens";

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: MIN_TOUCH,
    gap: SPACE.md,
    padding: SPACE.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADII.card,
    backgroundColor: COLORS.surface,
  },
  body: { flex: 1 },
  title: { fontSize: 15, fontWeight: "700", color: COLORS.text },
  subtitle: { fontSize: 13, color: COLORS.textMuted },
});

/** Leading element, title and subtitle, trailing element. Tappable when `onPress` is given. */
export function ListRow(props: {
  readonly title: string;
  readonly subtitle?: string;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly onPress?: () => void;
}) {
  const content = (
    <>
      {props.leading}
      <View style={styles.body}>
        <Text style={styles.title}>{props.title}</Text>
        {props.subtitle === undefined ? null : (
          <Text style={styles.subtitle}>{props.subtitle}</Text>
        )}
      </View>
      {props.trailing}
    </>
  );
  if (props.onPress === undefined) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={props.onPress} style={styles.row}>
      {content}
    </Pressable>
  );
}
