import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button } from "../../ui/Button";
import { formatDate } from "../../ui/dates";
import { formatMoney } from "../../ui/money";
import { TextField } from "../../ui/TextField";
import { COLORS, SPACE } from "../../ui/tokens";
import { METHODS, type Method, type PaymentErrors } from "./form";
import type { PaymentPreview } from "./service";

export type PreviewState =
  /** Nothing valid to preview yet. */
  | { readonly status: "none" }
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly preview: PaymentPreview };

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F9FAFB" },
  content: { padding: SPACE.xl, gap: SPACE.lg },
  title: { fontSize: 22, fontWeight: "800", color: COLORS.text },
  owes: { fontSize: 14, color: COLORS.textMuted },
  hint: { fontSize: 13, color: COLORS.textMuted },
  label: { fontSize: 13, color: COLORS.textMuted },
  methods: { flexDirection: "row", gap: SPACE.sm, flexWrap: "wrap" },
  preview: {
    gap: SPACE.xs,
    padding: SPACE.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  previewTitle: { fontSize: 15, fontWeight: "700", color: COLORS.text },
  line: { fontSize: 14, color: COLORS.text },
  banner: { fontSize: 14, color: COLORS.danger },
});

/** A4: record a payment. The preview is the server's answer, shown as it came. */
export function PaymentFormScreen(props: {
  readonly memberName: string | null;
  readonly balanceDue: number;
  readonly currency: string;
  readonly amount: string;
  readonly method: Method;
  readonly paidOn: string;
  readonly proofLink: string;
  readonly errors: PaymentErrors;
  /** Set when the amount is valid and more than what is owed. */
  readonly moreThanOwed: boolean;
  readonly preview: PreviewState;
  readonly banner: string | null;
  readonly busy: boolean;
  readonly onAmount: (text: string) => void;
  readonly onMethod: (method: Method) => void;
  readonly onPaidOn: (text: string) => void;
  readonly onProofLink: (text: string) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}) {
  const { errors, preview } = props;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>
        Record payment
      </Text>
      <Text style={styles.owes}>
        {props.memberName ?? "Customer"} owes {formatMoney(props.balanceDue, props.currency)}
      </Text>
      <TextField
        label="Amount"
        placeholder="0.00"
        value={props.amount}
        onChangeText={props.onAmount}
        {...(errors.amount === undefined ? {} : { error: errors.amount })}
      />
      {props.moreThanOwed ? (
        <Text style={styles.hint}>
          That is more than what is owed. The extra is kept as credit.
        </Text>
      ) : null}
      <View accessibilityLabel="Method" style={styles.methods}>
        {METHODS.map((entry) => (
          <Button
            key={entry.value}
            label={entry.label}
            kind={props.method === entry.value ? "primary" : "secondary"}
            onPress={() => props.onMethod(entry.value)}
          />
        ))}
      </View>
      <TextField
        label="Date received"
        placeholder="2026-11-26"
        value={props.paidOn}
        onChangeText={props.onPaidOn}
        {...(errors.paidOn === undefined ? {} : { error: errors.paidOn })}
      />
      <TextField
        label="Proof link (optional)"
        placeholder="https://"
        value={props.proofLink}
        onChangeText={props.onProofLink}
        {...(errors.proofLink === undefined ? {} : { error: errors.proofLink })}
      />
      <View style={styles.preview}>
        <Text accessibilityRole="header" style={styles.previewTitle}>
          What this covers
        </Text>
        {preview.status === "none" ? (
          <Text style={styles.hint}>Enter an amount to see what it covers.</Text>
        ) : null}
        {preview.status === "loading" ? <Text style={styles.hint}>Checking</Text> : null}
        {preview.status === "failed" ? <Text style={styles.hint}>{preview.message}</Text> : null}
        {preview.status === "ready" ? (
          <>
            <Text style={styles.line}>
              {preview.preview.invoicesCovered === 1
                ? "Covers 1 invoice"
                : `Covers ${preview.preview.invoicesCovered} invoices`}
            </Text>
            <Text style={styles.line}>
              Paid through{" "}
              {preview.preview.paidThroughAfter === null
                ? "not yet"
                : formatDate(preview.preview.paidThroughAfter)}
            </Text>
            <Text style={styles.line}>
              Credit left {formatMoney(preview.preview.creditAfter, props.currency)}
            </Text>
          </>
        ) : null}
      </View>
      {props.banner === null ? null : (
        <Text accessibilityRole="alert" style={styles.banner}>
          {props.banner}
        </Text>
      )}
      <Button
        label={props.busy ? "Saving" : "Record payment"}
        disabled={props.busy}
        onPress={props.onSubmit}
      />
      <Button label="Cancel" kind="secondary" disabled={props.busy} onPress={props.onCancel} />
    </ScrollView>
  );
}
