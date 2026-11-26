import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { cardStatus } from "../card/present";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { EmptyBlock, ErrorBlock, Skeleton } from "../ui/blocks";
import { StatusChip } from "../ui/chips";
import { COLORS, MIN_TOUCH, RADII, SPACE } from "../ui/tokens";
import type { SearchRow } from "./scan";

export type SearchState =
  /** Nothing typed yet. */
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "results"; readonly rows: readonly SearchRow[] };

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
  searchBox: {
    paddingHorizontal: SPACE.xl,
    paddingBottom: SPACE.md,
    backgroundColor: COLORS.surface,
  },
  input: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: SPACE.md,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: RADII.control,
    fontSize: 15,
    color: COLORS.text,
  },
  list: { padding: SPACE.lg, gap: 10 },
  card: {
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  top: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
  who: { flex: 1 },
  name: { fontSize: 16, fontWeight: "600", color: COLORS.text },
  number: { fontSize: 13, color: COLORS.textMuted },
});

function Row(props: {
  readonly row: SearchRow;
  readonly checkingIn: string | null;
  readonly onCheckIn: (row: SearchRow) => void;
}) {
  const { row } = props;
  const label = row.name ?? "member";
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Avatar name={row.name} />
        <View style={styles.who}>
          <Text style={styles.name}>{row.name ?? "Member"}</Text>
          <Text style={styles.number}>Member {row.memberNo}</Text>
        </View>
        <StatusChip status={cardStatus(row)} />
      </View>
      <Button
        label={props.checkingIn === row.memberId ? "Checking in" : `Check in ${label}`}
        disabled={props.checkingIn !== null}
        onPress={() => props.onCheckIn(row)}
      />
    </View>
  );
}

/** A1c: find a member by name, email or member number and check them in without the camera. */
export function CheckInSearchScreen(props: {
  readonly text: string;
  readonly state: SearchState;
  /** The member id whose check in is in flight. While set, every Check in button is disabled. */
  readonly checkingIn: string | null;
  readonly onText: (text: string) => void;
  readonly onCheckIn: (row: SearchRow) => void;
  readonly onRetry: () => void;
  readonly onBack: () => void;
}) {
  const { state } = props;
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Check in by search</Text>
        <Button
          label="Back to scanner"
          kind="secondary"
          disabled={props.checkingIn !== null}
          onPress={props.onBack}
        />
      </View>
      <View style={styles.searchBox}>
        <TextInput
          accessibilityLabel="Search members"
          placeholder="Search name, email or number"
          value={props.text}
          onChangeText={props.onText}
          style={styles.input}
        />
      </View>
      {state.status === "idle" ? (
        <EmptyBlock title="Search for a member" hint="Type a name, email or member number." />
      ) : null}
      {state.status === "loading" ? (
        <View style={styles.list}>
          <Skeleton lines={4} />
        </View>
      ) : null}
      {state.status === "failed" ? (
        <ErrorBlock message={state.message} onRetry={props.onRetry} />
      ) : null}
      {state.status === "results" && state.rows.length === 0 ? (
        <EmptyBlock
          title={`No one matches "${props.text.trim()}"`}
          hint="Check the spelling, or try their email or member number."
        />
      ) : null}
      {state.status === "results" && state.rows.length > 0 ? (
        <ScrollView contentContainerStyle={styles.list}>
          {state.rows.map((row) => (
            <Row
              key={row.memberId}
              row={row}
              checkingIn={props.checkingIn}
              onCheckIn={props.onCheckIn}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}
