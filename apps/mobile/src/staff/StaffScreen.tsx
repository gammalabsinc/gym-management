import { FlatList, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { EmptyBlock } from "../ui/blocks";
import { Chip } from "../ui/chips";
import { COLORS, SPACE } from "../ui/tokens";
import type { StaffPerson, StaffRole } from "./service";

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F9FAFB" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: SPACE.xl,
    backgroundColor: COLORS.surface,
  },
  title: { fontSize: 22, fontWeight: "800", color: COLORS.text },
  list: { padding: SPACE.lg, gap: 10 },
  card: {
    gap: SPACE.md,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  top: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
  who: { flex: 1 },
  name: { fontSize: 16, fontWeight: "600", color: COLORS.text },
  email: { fontSize: 13, color: COLORS.textMuted },
  roles: { flexDirection: "row", gap: SPACE.sm },
  note: { fontSize: 13, color: COLORS.textMuted },
  banner: { padding: SPACE.md, fontSize: 14, color: COLORS.danger },
});

export const LAST_OWNER_NOTE = "A gym needs at least one owner. Make someone else an owner first.";

function Person(props: {
  readonly person: StaffPerson;
  readonly locked: boolean;
  readonly onRole: (person: StaffPerson, role: StaffRole) => void;
  readonly onRemove: (person: StaffPerson) => void;
}) {
  const { person, locked } = props;
  const label = person.name ?? person.email;
  const choose = (role: StaffRole) => {
    if (!locked && role !== person.role) props.onRole(person, role);
  };
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Avatar name={person.name} email={person.email} />
        <View style={styles.who}>
          <Text style={styles.name}>{label}</Text>
          <Text style={styles.email}>{person.email}</Text>
        </View>
        {person.hasSignedIn ? null : <Chip label="Invited" tone="warn" />}
      </View>
      <View accessibilityLabel={`Role for ${label}`} style={styles.roles}>
        <Button
          label={`Owner ${label}`}
          kind={person.role === "owner" ? "primary" : "secondary"}
          disabled={locked}
          onPress={() => choose("owner")}
        />
        <Button
          label={`Staff ${label}`}
          kind={person.role === "staff" ? "primary" : "secondary"}
          disabled={locked}
          onPress={() => choose("staff")}
        />
      </View>
      {locked ? <Text style={styles.note}>{LAST_OWNER_NOTE}</Text> : null}
      {locked ? null : (
        <Button
          label={`Remove access ${label}`}
          kind="danger"
          onPress={() => props.onRemove(person)}
        />
      )}
    </View>
  );
}

/** A7: the people who can sign in to the staff side. The last owner cannot be changed or removed. */
export function StaffScreen(props: {
  readonly people: readonly StaffPerson[];
  readonly banner: string | null;
  readonly onInvite: () => void;
  readonly onRole: (person: StaffPerson, role: StaffRole) => void;
  readonly onRemove: (person: StaffPerson) => void;
}) {
  const owners = props.people.filter((person) => person.role === "owner");
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Staff</Text>
        <Button label="Invite" onPress={props.onInvite} />
      </View>
      {props.banner === null ? null : (
        <Text accessibilityRole="alert" style={styles.banner}>
          {props.banner}
        </Text>
      )}
      {props.people.length === 0 ? (
        <EmptyBlock title="No staff yet" hint="Invite someone with their Google email." />
      ) : (
        <FlatList
          data={props.people}
          keyExtractor={(person) => person.userId}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Person
              person={item}
              locked={item.role === "owner" && owners.length === 1}
              onRole={props.onRole}
              onRemove={props.onRemove}
            />
          )}
        />
      )}
    </View>
  );
}
