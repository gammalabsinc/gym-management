import { StyleSheet, Text, View } from "react-native";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { formatDate } from "../ui/dates";
import { ListRow } from "../ui/ListRow";
import { COLORS, SPACE } from "../ui/tokens";
import type { Profile } from "./service";

const styles = StyleSheet.create({
  container: { flex: 1, padding: SPACE.xl, gap: SPACE.lg },
  header: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
  name: { fontSize: 22, fontWeight: "700", color: COLORS.text },
  since: { fontSize: 14, color: COLORS.textMuted },
  heading: { fontSize: 16, fontWeight: "700", color: COLORS.text },
  group: { gap: SPACE.sm },
  error: { fontSize: 14, color: COLORS.text },
});

export const SIGN_OUT_FAILED_MESSAGE =
  "Signed out, but this device could not clear everything. Close the app and open it again.";

/** M6. Read only: there is no edit control. A missing gym phone, email or address hides its row. */
export function ProfileScreen(props: {
  readonly profile: Profile;
  readonly signOutError: boolean;
  readonly onCall: (phone: string) => void;
  readonly onEmail: (email: string) => void;
  readonly onSignOut: () => void;
}) {
  const { profile } = props;
  const { gym } = profile;
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Avatar name={profile.name} email={profile.email} size={56} />
        <View>
          <Text style={styles.name}>{profile.name ?? "Member"}</Text>
          <Text style={styles.since}>Member since {formatDate(profile.joinedOn)}</Text>
        </View>
      </View>
      <View style={styles.group}>
        <ListRow title="Email" subtitle={profile.email} />
        <ListRow title="Plan" subtitle={profile.planName} />
        <ListRow title="Member number" subtitle={profile.memberNo} />
        <ListRow title="Joined" subtitle={formatDate(profile.joinedOn)} />
      </View>
      <View style={styles.group}>
        <Text accessibilityRole="header" style={styles.heading}>
          Your gym
        </Text>
        <ListRow title={gym.name} />
        {gym.phone === null ? null : (
          <ListRow
            title="Call"
            subtitle={gym.phone}
            onPress={() => props.onCall(gym.phone ?? "")}
          />
        )}
        {gym.email === null ? null : (
          <ListRow
            title="Email the gym"
            subtitle={gym.email}
            onPress={() => props.onEmail(gym.email ?? "")}
          />
        )}
        {gym.address === null ? null : <ListRow title="Address" subtitle={gym.address} />}
      </View>
      {props.signOutError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {SIGN_OUT_FAILED_MESSAGE}
        </Text>
      ) : null}
      <Button label="Sign out" kind="secondary" onPress={props.onSignOut} />
    </View>
  );
}
