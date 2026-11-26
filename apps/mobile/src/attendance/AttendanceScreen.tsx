import { FlatList, StyleSheet, Text, View } from "react-native";
import { Button } from "../ui/Button";
import { EmptyBlock, ErrorBlock, Skeleton } from "../ui/blocks";
import { formatDay, formatTime } from "../ui/dates";
import { COLORS, RADII, SPACE } from "../ui/tokens";
import { type AttendanceListRow, toListRows } from "./group";
import type { AttendanceState } from "./useAttendance";

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F9FAFB" },
  list: { padding: SPACE.lg, gap: SPACE.sm },
  counts: { flexDirection: "row", gap: SPACE.md },
  count: {
    flex: 1,
    gap: SPACE.xs,
    padding: SPACE.lg,
    borderRadius: RADII.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  countValue: { fontSize: 28, fontWeight: "800", color: COLORS.text },
  countLabel: { fontSize: 13, color: COLORS.textMuted },
  month: { marginTop: SPACE.md, fontSize: 15, fontWeight: "700", color: COLORS.text },
  visit: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: SPACE.md,
    borderRadius: RADII.control,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  day: { fontSize: 15, color: COLORS.text },
  time: { fontSize: 15, color: COLORS.textMuted },
});

type ReadyState = Extract<AttendanceState, { status: "ready" }>;

type Row = { readonly kind: "counts"; readonly key: "counts" } | AttendanceListRow;

function Counts(props: { readonly thisMonth: number; readonly lastMonth: number }) {
  return (
    <View style={styles.counts}>
      <View style={styles.count} accessibilityLabel={`${props.thisMonth} visits this month`}>
        <Text style={styles.countValue}>{props.thisMonth}</Text>
        <Text style={styles.countLabel}>This month</Text>
      </View>
      <View style={styles.count} accessibilityLabel={`${props.lastMonth} visits last month`}>
        <Text style={styles.countValue}>{props.lastMonth}</Text>
        <Text style={styles.countLabel}>Last month</Text>
      </View>
    </View>
  );
}

function Item(props: { readonly row: Row; readonly state: ReadyState }) {
  const { row, state } = props;
  if (row.kind === "counts") {
    return <Counts thisMonth={state.visitsThisMonth} lastMonth={state.visitsLastMonth} />;
  }
  if (row.kind === "month") {
    return (
      <Text accessibilityRole="header" style={styles.month}>
        {row.label}
      </Text>
    );
  }
  return (
    <View style={styles.visit}>
      <Text style={styles.day}>{formatDay(row.visit.localDate)}</Text>
      <Text style={styles.time}>{formatTime(row.visit.scannedAt, state.timezone)}</Text>
    </View>
  );
}

/** M5: this month and last month, then every visit under its month, newest first. */
export function AttendanceScreen(props: {
  readonly state: AttendanceState;
  readonly onRetry: () => void;
  readonly onEndReached: () => void;
}) {
  const { state } = props;
  if (state.status === "loading") {
    return (
      <View style={styles.screen}>
        <View style={styles.list}>
          <Skeleton lines={5} />
        </View>
      </View>
    );
  }
  if (state.status === "error") {
    return <ErrorBlock message="Could not load your visits" onRetry={props.onRetry} />;
  }
  const rows: Row[] = [{ kind: "counts", key: "counts" }, ...toListRows(state.items)];
  return (
    <View style={styles.screen}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item }) => <Item row={item} state={state} />}
        contentContainerStyle={styles.list}
        onEndReached={props.onEndReached}
        onEndReachedThreshold={0.5}
      />
      {state.items.length === 0 ? (
        <EmptyBlock title="No visits yet" hint="Your visits show here after you scan in." />
      ) : null}
      {state.loadingMore ? <Skeleton lines={2} /> : null}
      {state.moreFailed ? (
        <View>
          <Text accessibilityRole="alert">Could not load older visits</Text>
          <Button label="Try again" kind="secondary" onPress={props.onEndReached} />
        </View>
      ) : null}
    </View>
  );
}
