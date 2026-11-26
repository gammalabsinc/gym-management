import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { GymChoice } from "../gyms";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { ListRow } from "../ui/ListRow";
import { COLORS, SPACE } from "../ui/tokens";

const styles = StyleSheet.create({
  container: { flex: 1, padding: SPACE.xl, gap: SPACE.lg, justifyContent: "center" },
  heading: { fontSize: 24, fontWeight: "700", color: COLORS.text },
  body: { fontSize: 15, color: COLORS.textMuted },
  list: { gap: SPACE.sm },
});

const ROLE_LABEL = { owner: "Owner", staff: "Staff", member: "Member" } as const;

function roleLine(gym: GymChoice): string {
  return gym.roles.map((role) => ROLE_LABEL[role]).join(", ");
}

/** M2: the gyms this email belongs to. */
export function GymPickerScreen(props: {
  readonly gyms: readonly GymChoice[];
  readonly onPick: (tenantId: string) => void;
  readonly onUseAnotherAccount: () => void;
  readonly error?: string;
  readonly busy?: boolean;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Choose your gym</Text>
      <Text style={styles.body}>This account belongs to more than one gym.</Text>
      {props.error === undefined ? null : (
        <View accessibilityRole="alert">
          <Text style={styles.body}>{props.error}</Text>
        </View>
      )}
      <ScrollView>
        <View style={styles.list}>
          {props.gyms.map((gym) => (
            <ListRow
              key={gym.tenantId}
              title={gym.name}
              subtitle={roleLine(gym)}
              leading={<Avatar name={gym.name} />}
              onPress={() => {
                if (props.busy !== true) props.onPick(gym.tenantId);
              }}
            />
          ))}
        </View>
      </ScrollView>
      <Button label="Use another account" kind="secondary" onPress={props.onUseAnotherAccount} />
    </View>
  );
}

/** M3: signed in, but no gym has this email on file. */
export function NoGymScreen(props: {
  readonly onTryAgain: () => void;
  readonly onUseAnotherAccount: () => void;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>No gym found</Text>
      <Text style={styles.body}>
        No gym has this Google account on file. Ask your gym to add your email, or sign in with
        another account.
      </Text>
      <Button label="Try again" onPress={props.onTryAgain} />
      <Button label="Use another account" kind="secondary" onPress={props.onUseAnotherAccount} />
    </View>
  );
}
