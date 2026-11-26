import { StyleSheet, Text, View } from "react-native";
import { Button } from "../ui/Button";
import { COLORS, RADII, SPACE, TONES } from "../ui/tokens";

export type SignInView =
  | { readonly state: "default" }
  | { readonly state: "signingIn" }
  | { readonly state: "error"; readonly message: string };

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: SPACE.xl, gap: SPACE.lg },
  heading: { fontSize: 28, fontWeight: "700", color: COLORS.text },
  body: { fontSize: 16, color: COLORS.textMuted },
  alert: {
    padding: SPACE.md,
    borderRadius: RADII.control,
    borderWidth: 1,
    backgroundColor: TONES.bad.background,
    borderColor: TONES.bad.border,
  },
  alertText: { fontSize: 14, color: TONES.bad.text },
  footnote: { fontSize: 13, color: COLORS.textMuted },
});

/** M1. Presentational: the container decides which state to show. */
export function SignInScreen(props: {
  readonly view: SignInView;
  readonly onContinue: () => void;
}) {
  const busy = props.view.state === "signingIn";
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Welcome to your gym.</Text>
      <Text style={styles.body}>
        Members, staff and owners sign in here with the Google account the gym has on file. Your
        role decides what you see.
      </Text>
      {props.view.state === "error" ? (
        <View accessibilityRole="alert" style={styles.alert}>
          <Text style={styles.alertText}>{props.view.message}</Text>
        </View>
      ) : null}
      <Button
        label={busy ? "Signing in" : "Continue with Google"}
        onPress={props.onContinue}
        disabled={busy}
      />
      <Text style={styles.footnote}>We only use your name and email.</Text>
    </View>
  );
}
