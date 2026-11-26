import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "../ui/BottomSheet";
import { Button } from "../ui/Button";
import { TextField } from "../ui/TextField";
import { COLORS, SPACE } from "../ui/tokens";
import type { StaffRole } from "./service";

const styles = StyleSheet.create({
  text: { fontSize: 15, color: COLORS.text },
  note: { fontSize: 13, color: COLORS.textMuted },
  error: { fontSize: 14, color: COLORS.danger },
  toggle: { flexDirection: "row", gap: SPACE.sm },
});

/** A yes or no question about one change. The server's answer comes back as `error`. */
export function ConfirmSheet(props: {
  readonly title: string;
  readonly description: string;
  readonly primary: string;
  readonly secondary: string;
  readonly danger: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <BottomSheet visible title={props.title} onClose={props.onCancel}>
      <Text style={styles.text}>{props.description}</Text>
      {props.error === null ? null : (
        <Text accessibilityRole="alert" style={styles.error}>
          {props.error}
        </Text>
      )}
      <Button
        label={props.busy ? "Saving" : props.primary}
        kind={props.danger ? "danger" : "primary"}
        onPress={props.onConfirm}
        disabled={props.busy}
      />
      <Button
        label={props.secondary}
        kind="secondary"
        onPress={props.onCancel}
        disabled={props.busy}
      />
    </BottomSheet>
  );
}

/** Invite by Google email, with an optional name and a role. No email is sent. */
export function InviteSheet(props: {
  readonly busy: boolean;
  readonly emailError: string | null;
  readonly error: string | null;
  readonly onSubmit: (input: { email: string; name: string; role: StaffRole }) => void;
  readonly onCancel: () => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<StaffRole>("staff");
  const [localError, setLocalError] = useState<string | null>(null);

  function submit() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setLocalError("Enter a Google email, like name@gmail.com.");
      return;
    }
    setLocalError(null);
    props.onSubmit({ email, name, role });
  }

  const shown = localError ?? props.emailError;
  return (
    <BottomSheet visible title="Invite staff" onClose={props.onCancel}>
      <TextField
        label="Google email"
        placeholder="name@gmail.com"
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          setLocalError(null);
        }}
        {...(shown === null ? {} : { error: shown })}
      />
      <TextField label="Name (optional)" value={name} onChangeText={setName} />
      <View accessibilityLabel="Role" style={styles.toggle}>
        <Button
          label="Owner"
          kind={role === "owner" ? "primary" : "secondary"}
          onPress={() => setRole("owner")}
        />
        <Button
          label="Staff"
          kind={role === "staff" ? "primary" : "secondary"}
          onPress={() => setRole("staff")}
        />
      </View>
      <Text style={styles.note}>
        No email is sent. Tell them to open the Gym app and sign in with this Google account.
      </Text>
      {props.error === null ? null : (
        <Text accessibilityRole="alert" style={styles.error}>
          {props.error}
        </Text>
      )}
      <Button
        label={props.busy ? "Saving" : "Add to staff"}
        onPress={submit}
        disabled={props.busy}
      />
    </BottomSheet>
  );
}
