import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../ui/Button";
import { formatDate } from "../ui/dates";
import { formatMoney } from "../ui/money";
import { TextField } from "../ui/TextField";
import { COLORS, RADII, SPACE } from "../ui/tokens";
import type { Errors, FieldKey, InvoicePreview } from "./form";

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F9FAFB" },
  body: { padding: SPACE.xl, gap: SPACE.lg },
  title: { fontSize: 22, fontWeight: "800", color: COLORS.text },
  readOnly: { gap: 2 },
  readLabel: { fontSize: 13, fontWeight: "600", color: COLORS.textMuted },
  readValue: { fontSize: 15, color: COLORS.text },
  card: {
    gap: SPACE.sm,
    padding: SPACE.lg,
    borderRadius: RADII.control,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", color: COLORS.text },
  line: { flexDirection: "row", justifyContent: "space-between" },
  lineText: { fontSize: 14, color: COLORS.text },
  total: { fontSize: 14, fontWeight: "700", color: COLORS.text },
  problem: { fontSize: 14, color: COLORS.danger },
});

/** A value the person cannot change here, shown as text and not as an input. */
export function ReadOnlyField(props: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.readOnly}>
      <Text style={styles.readLabel}>{props.label}</Text>
      <Text style={styles.readValue}>{props.value}</Text>
    </View>
  );
}

/** What the first invoice will hold, from the gym's current fees. */
export function InvoicePreviewCard(props: {
  readonly preview: InvoicePreview | null;
  readonly currency: string;
}) {
  const { preview, currency } = props;
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>First invoice</Text>
      {preview === null ? (
        <Text style={styles.readValue}>Enter the join date to see the first invoice.</Text>
      ) : (
        <>
          <View style={styles.line}>
            <Text style={styles.lineText}>Admission</Text>
            <Text style={styles.lineText}>{formatMoney(preview.admission, currency)}</Text>
          </View>
          <View style={styles.line}>
            <Text style={styles.lineText}>Monthly</Text>
            <Text style={styles.lineText}>{formatMoney(preview.monthly, currency)}</Text>
          </View>
          <View style={styles.line}>
            <Text style={styles.total}>Total</Text>
            <Text style={styles.total}>{formatMoney(preview.total, currency)}</Text>
          </View>
          <Text style={styles.readValue}>{`Due ${formatDate(preview.dueOn)}`}</Text>
        </>
      )}
    </View>
  );
}

/** The A5 layout for both Add and Edit. The caller decides which fields are inputs and which are text. */
export function MemberFormScreen(props: {
  readonly title: string;
  readonly values: Readonly<Record<FieldKey, string>>;
  readonly errors: Errors;
  readonly general: string | null;
  readonly saving: boolean;
  readonly saveLabel: string;
  readonly editable: readonly FieldKey[];
  readonly onChange: (key: FieldKey, text: string) => void;
  readonly onSave: () => void;
  readonly onCancel: () => void;
  readonly readOnly?: ReactNode;
  readonly children?: ReactNode;
}) {
  const inputs: ReadonlyArray<{ key: FieldKey; label: string; placeholder?: string }> = [
    { key: "name", label: "Full name" },
    { key: "email", label: "Google email" },
    { key: "phone", label: "Phone (optional)" },
    { key: "joinedOn", label: "Join date", placeholder: "2026-12-13" },
  ];
  return (
    <ScrollView style={styles.screen}>
      <View style={styles.body}>
        <Text style={styles.title}>{props.title}</Text>
        {inputs
          .filter((input) => props.editable.includes(input.key))
          .map((input) => (
            <TextField
              key={input.key}
              label={input.label}
              value={props.values[input.key]}
              {...(input.placeholder === undefined ? {} : { placeholder: input.placeholder })}
              {...(props.errors[input.key] === undefined ? {} : { error: props.errors[input.key] })}
              onChangeText={(text) => props.onChange(input.key, text)}
            />
          ))}
        {props.readOnly}
        {props.children}
        {props.general === null ? null : (
          <Text accessibilityRole="alert" style={styles.problem}>
            {props.general}
          </Text>
        )}
        <Button
          label={props.saving ? "Saving" : props.saveLabel}
          disabled={props.saving}
          onPress={props.onSave}
        />
        <Button label="Cancel" kind="secondary" disabled={props.saving} onPress={props.onCancel} />
      </View>
    </ScrollView>
  );
}
