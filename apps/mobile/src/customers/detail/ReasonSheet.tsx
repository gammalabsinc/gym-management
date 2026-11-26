import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { BottomSheet } from "../../ui/BottomSheet";
import { Button } from "../../ui/Button";
import { TextField } from "../../ui/TextField";
import { COLORS } from "../../ui/tokens";

export const REASON_MAX = 500;
export const REASON_REQUIRED = "Say why. A reason is required.";
export const REASON_TOO_LONG = `Keep the reason under ${REASON_MAX} characters.`;

const styles = StyleSheet.create({
  text: { fontSize: 15, color: COLORS.text },
  error: { fontSize: 14, color: COLORS.danger },
});

/** A change that needs a written reason. Confirm stays off until there is one. The server's answer is `error`. */
export function ReasonSheet(props: {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly danger: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onConfirm: (reason: string) => void;
  readonly onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const trimmed = reason.trim();
  const local =
    trimmed === ""
      ? touched
        ? REASON_REQUIRED
        : null
      : trimmed.length > REASON_MAX
        ? REASON_TOO_LONG
        : null;
  const ready = trimmed !== "" && trimmed.length <= REASON_MAX;
  return (
    <BottomSheet visible title={props.title} onClose={props.onCancel}>
      <Text style={styles.text}>{props.description}</Text>
      <TextField
        label="Reason"
        value={reason}
        onChangeText={(text) => {
          setReason(text);
          setTouched(true);
        }}
        {...(local === null ? {} : { error: local })}
      />
      {props.error === null ? null : (
        <Text accessibilityRole="alert" style={styles.error}>
          {props.error}
        </Text>
      )}
      <Button
        label={props.busy ? "Saving" : props.confirmLabel}
        kind={props.danger ? "danger" : "primary"}
        disabled={props.busy || !ready}
        onPress={() => props.onConfirm(trimmed)}
      />
      <Button label="Cancel" kind="secondary" disabled={props.busy} onPress={props.onCancel} />
    </BottomSheet>
  );
}
