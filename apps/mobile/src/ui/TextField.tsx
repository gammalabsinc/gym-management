import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useBrand } from "./brand";
import { COLORS, MIN_TOUCH, RADII, SPACE } from "./tokens";

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "600", color: COLORS.textMuted, marginBottom: SPACE.xs },
  input: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: SPACE.md,
    borderRadius: RADII.control,
    borderWidth: 1,
    fontSize: 15,
    color: COLORS.text,
  },
  hint: { fontSize: 13, marginTop: SPACE.xs },
});

/** A labelled input. The border is the brand colour while focused and red with a hint when there is an error. */
export function TextField(props: {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly error?: string;
  readonly placeholder?: string;
}) {
  const brand = useBrand();
  const [focused, setFocused] = useState(false);
  const border =
    props.error === undefined ? (focused ? brand.color : COLORS.inputBorder) : COLORS.danger;
  return (
    <View>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        accessibilityLabel={props.label}
        value={props.value}
        placeholder={props.placeholder}
        onChangeText={props.onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.input, { borderColor: border }]}
      />
      {props.error === undefined ? null : (
        <Text accessibilityRole="alert" style={[styles.hint, { color: COLORS.danger }]}>
          {props.error}
        </Text>
      )}
    </View>
  );
}
