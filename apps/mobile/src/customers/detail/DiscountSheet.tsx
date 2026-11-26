import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { parseMoneyInput } from "../../settings/money-input";
import { BottomSheet } from "../../ui/BottomSheet";
import { Button } from "../../ui/Button";
import { TextField } from "../../ui/TextField";
import { COLORS, SPACE } from "../../ui/tokens";
import { REASON_MAX, REASON_REQUIRED, REASON_TOO_LONG } from "./ReasonSheet";
import type { NewDiscount } from "./service";

export const AMOUNT_ZERO = "Enter an amount more than zero.";
export const DISCOUNT_NOTE =
  "A new discount applies from the next invoice that is generated. Invoices already made do not change.";

const styles = StyleSheet.create({
  text: { fontSize: 15, color: COLORS.text },
  error: { fontSize: 14, color: COLORS.danger },
  kinds: { flexDirection: "row", gap: SPACE.sm },
});

/** The amount as integer minor units, or the message for the field. Zero buys nothing, so it is refused. */
export function readAmount(
  text: string,
  currency: string,
): { readonly ok: true; readonly minor: number } | { readonly ok: false; readonly error: string } {
  const parsed = parseMoneyInput(text, currency);
  if (!parsed.ok) return parsed;
  return parsed.minor > 0 ? parsed : { ok: false, error: AMOUNT_ZERO };
}

/** A manual discount: amount, one time or every month, and a reason. Save stays off until all three are right. */
export function DiscountSheet(props: {
  readonly currency: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSave: (discount: NewDiscount) => void;
  readonly onCancel: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState({ amount: false, reason: false });
  const parsed = readAmount(amount, props.currency);
  const trimmed = reason.trim();
  const reasonError =
    trimmed === "" ? REASON_REQUIRED : trimmed.length > REASON_MAX ? REASON_TOO_LONG : null;
  const amountShown = touched.amount && !parsed.ok ? parsed.error : null;
  const reasonShown = touched.reason ? reasonError : null;
  return (
    <BottomSheet visible title="Add a discount" onClose={props.onCancel}>
      <Text style={styles.text}>{DISCOUNT_NOTE}</Text>
      <TextField
        label="Amount"
        value={amount}
        onChangeText={(text) => {
          setAmount(text);
          setTouched((current) => ({ ...current, amount: true }));
        }}
        {...(amountShown === null ? {} : { error: amountShown })}
      />
      <View style={styles.kinds}>
        <Button
          label="One time"
          kind={recurring ? "secondary" : "primary"}
          onPress={() => setRecurring(false)}
        />
        <Button
          label="Every month"
          kind={recurring ? "primary" : "secondary"}
          onPress={() => setRecurring(true)}
        />
      </View>
      <TextField
        label="Reason"
        value={reason}
        onChangeText={(text) => {
          setReason(text);
          setTouched((current) => ({ ...current, reason: true }));
        }}
        {...(reasonShown === null ? {} : { error: reasonShown })}
      />
      {props.error === null ? null : (
        <Text accessibilityRole="alert" style={styles.error}>
          {props.error}
        </Text>
      )}
      <Button
        label={props.busy ? "Saving" : "Add discount"}
        disabled={props.busy || !parsed.ok || reasonError !== null}
        onPress={() => {
          if (parsed.ok && reasonError === null) {
            props.onSave({ amount: parsed.minor, isRecurring: recurring, reason: trimmed });
          }
        }}
      />
      <Button label="Cancel" kind="secondary" disabled={props.busy} onPress={props.onCancel} />
    </BottomSheet>
  );
}
