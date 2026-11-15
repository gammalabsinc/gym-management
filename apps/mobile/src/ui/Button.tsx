import { Pressable, StyleSheet, Text } from "react-native";
import { useBrand } from "./brand";
import { COLORS, MIN_TOUCH, RADII, SPACE } from "./tokens";

export type ButtonKind = "primary" | "secondary" | "danger";

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    paddingHorizontal: SPACE.lg,
    borderRadius: RADII.control,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  label: { fontSize: 15, fontWeight: "600" },
});

/** Primary uses the gym brand colour. Secondary and danger are fixed. At least 44 points in both directions. */
export function Button(props: {
  readonly label: string;
  readonly onPress: () => void;
  readonly kind?: ButtonKind;
  readonly disabled?: boolean;
}) {
  const brand = useBrand();
  const kind = props.kind ?? "primary";
  const look = {
    primary: { background: brand.color, border: brand.color, text: brand.onColor },
    secondary: { background: COLORS.surface, border: COLORS.inputBorder, text: COLORS.text },
    danger: { background: COLORS.surface, border: COLORS.dangerBorder, text: COLORS.danger },
  }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled === true }}
      disabled={props.disabled === true}
      onPress={props.onPress}
      style={[
        styles.base,
        { backgroundColor: look.background, borderColor: look.border },
        props.disabled === true ? { opacity: 0.5 } : null,
      ]}
    >
      <Text style={[styles.label, { color: look.text }]}>{props.label}</Text>
    </Pressable>
  );
}
