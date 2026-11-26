import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { COLORS, RADII, SPACE } from "../ui/tokens";
import type { Errors, FieldKey, Form } from "./form";
import type { SettingsData } from "./service";

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F9FAFB" },
  title: { fontSize: 22, fontWeight: "800", color: COLORS.text, padding: SPACE.xl },
  body: { padding: SPACE.lg, gap: SPACE.md },
  heading: { fontSize: 13, fontWeight: "700", color: COLORS.textMuted, textTransform: "uppercase" },
  box: {
    gap: SPACE.md,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  note: { fontSize: 13, color: COLORS.textMuted },
  preview: {
    padding: SPACE.md,
    borderRadius: RADII.control,
    backgroundColor: "#F3F4F6",
    fontSize: 14,
    color: COLORS.text,
  },
  row: { flexDirection: "row", justifyContent: "space-between" },
  rowLabel: { fontSize: 14, color: COLORS.textMuted },
  rowValue: { fontSize: 14, color: COLORS.text },
  toggle: { flexDirection: "row", gap: SPACE.sm },
  footer: { padding: SPACE.lg, backgroundColor: COLORS.surface },
  error: { fontSize: 14, color: COLORS.danger },
});

function Repeat(props: {
  readonly label: string;
  readonly recurring: boolean;
  readonly onChange: (recurring: boolean) => void;
}) {
  return (
    <View accessibilityLabel={`${props.label} repeat`} style={styles.toggle}>
      <Button
        label={`${props.label} one time`}
        kind={props.recurring ? "secondary" : "primary"}
        onPress={() => props.onChange(false)}
      />
      <Button
        label={`${props.label} monthly`}
        kind={props.recurring ? "primary" : "secondary"}
        onPress={() => props.onChange(true)}
      />
    </View>
  );
}

/** A6: the owner's gym settings. Server problems show on the field they belong to. */
export function SettingsScreen(props: {
  readonly data: SettingsData;
  readonly form: Form;
  readonly errors: Errors;
  readonly generalError: string | null;
  readonly preview: string | null;
  readonly saving: boolean;
  readonly dirty: boolean;
  readonly onText: (key: FieldKey, text: string) => void;
  readonly onRecurring: (
    key: "referrerIsRecurring" | "referredIsRecurring",
    value: boolean,
  ) => void;
  readonly onSave: () => void;
}) {
  const { form, errors, data } = props;
  const field = (key: FieldKey, label: string) => (
    <TextField
      label={label}
      value={form[key]}
      onChangeText={(text) => props.onText(key, text)}
      {...(errors[key] === undefined ? {} : { error: errors[key] })}
    />
  );
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Gym settings</Text>
      <ScrollView>
        <View style={styles.body}>
          <Text style={styles.heading}>Fees</Text>
          <View style={styles.box}>
            {field("admissionFee", "Admission")}
            {field("monthlyFee", "Monthly")}
            <Text style={styles.note}>
              New fees apply to invoices made from now on. Past invoices never change.
            </Text>
          </View>

          <Text style={styles.heading}>Referral defaults</Text>
          <View style={styles.box}>
            {field("referrerAmount", "Person who refers")}
            <Repeat
              label="Person who refers"
              recurring={form.referrerIsRecurring}
              onChange={(value) => props.onRecurring("referrerIsRecurring", value)}
            />
            {field("referredAmount", "New member")}
            <Repeat
              label="New member"
              recurring={form.referredIsRecurring}
              onChange={(value) => props.onRecurring("referredIsRecurring", value)}
            />
            {props.preview === null ? null : <Text style={styles.preview}>{props.preview}</Text>}
            <Text style={styles.note}>
              Applies to new referrals only. Discounts never take a monthly fee below zero. Set an
              amount to 0 for no discount.
            </Text>
          </View>

          <Text style={styles.heading}>Payment reminders</Text>
          <View style={styles.box}>
            {field("warnDaysBefore", "Due soon from (days before)")}
            {field("redDaysAfter", "Overdue after (days late)")}
            {field("dupWindowMin", "Ignore repeat scans within (minutes)")}
          </View>

          <Text style={styles.heading}>Gym details</Text>
          <View style={styles.box}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Name</Text>
              <Text style={styles.rowValue}>{data.details.name}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Colour</Text>
              <Text style={styles.rowValue}>{data.details.color ?? "Default"}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Timezone</Text>
              <Text style={styles.rowValue}>{data.details.timezone}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Currency</Text>
              <Text style={styles.rowValue}>{data.details.currency}</Text>
            </View>
            <Text style={styles.note}>To change these, contact us.</Text>
          </View>
        </View>
      </ScrollView>
      <View style={styles.footer}>
        {props.generalError === null ? null : (
          <Text accessibilityRole="alert" style={styles.error}>
            {props.generalError}
          </Text>
        )}
        <Button
          label={props.saving ? "Saving" : "Save settings"}
          onPress={props.onSave}
          disabled={props.saving || !props.dirty}
        />
      </View>
    </View>
  );
}
