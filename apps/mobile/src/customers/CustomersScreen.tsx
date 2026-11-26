import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { cardStatus } from "../card/present";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { EmptyBlock, ErrorBlock, Skeleton } from "../ui/blocks";
import { StatusChip } from "../ui/chips";
import { formatDate } from "../ui/dates";
import { formatMoney } from "../ui/money";
import { COLORS, MIN_TOUCH, RADII, SPACE } from "../ui/tokens";
import type { CustomerRow } from "./list";
import type { CustomersState } from "./useCustomers";

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
  order: { marginTop: SPACE.sm, fontSize: 13, color: COLORS.textMuted },
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
  paid: { fontSize: 13, color: COLORS.textMuted },
  figures: { flexDirection: "row", gap: SPACE.sm },
  figure: { flex: 1, fontSize: 13, color: COLORS.textMuted },
  value: { fontSize: 15, fontWeight: "700", color: COLORS.text },
});

function Card(props: { readonly row: CustomerRow; readonly onOpen: (id: string) => void }) {
  const { row } = props;
  const paid =
    row.paidThrough === null ? "Not paid yet" : `Paid through ${formatDate(row.paidThrough)}`;
  return (
    <View
      accessibilityRole="button"
      accessibilityLabel={row.name ?? "Customer"}
      style={styles.card}
    >
      <View style={styles.top}>
        <Avatar name={row.name} />
        <View style={styles.who}>
          <Text style={styles.name}>{row.name ?? "Customer"}</Text>
          <Text style={styles.paid}>{paid}</Text>
        </View>
        <StatusChip status={cardStatus(row)} />
      </View>
      <View style={styles.figures}>
        <Text style={styles.figure}>
          Due <Text style={styles.value}>{formatMoney(row.balanceDue, row.currency)}</Text>
        </Text>
        <Text style={styles.figure}>
          Visits{" "}
          <Text style={styles.value}>{`${row.visitsThisMonth} / ${row.visitsLastMonth}`}</Text>
        </Text>
        <Text style={styles.figure}>
          Total paid <Text style={styles.value}>{formatMoney(row.totalPaid, row.currency)}</Text>
        </Text>
      </View>
      <Button
        label={`Open ${row.name ?? "customer"}`}
        kind="secondary"
        onPress={() => props.onOpen(row.id)}
      />
    </View>
  );
}

/** A2: customers, in the server's order, with search and an Add button. */
export function CustomersScreen(props: {
  readonly state: CustomersState;
  readonly refreshing: boolean;
  readonly search: string;
  readonly onSearch: (text: string) => void;
  readonly onAdd: () => void;
  readonly onOpen: (id: string) => void;
  readonly onRefresh: () => void;
  readonly onRetry: () => void;
  readonly onEndReached: () => void;
}) {
  const { state } = props;
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>Customers</Text>
        <Button label="Add" onPress={props.onAdd} />
      </View>
      <View style={styles.searchBox}>
        <TextInput
          accessibilityLabel="Search customers"
          placeholder="Search name, email or number"
          value={props.search}
          onChangeText={props.onSearch}
          style={styles.input}
        />
        <Text style={styles.order}>Overdue first</Text>
      </View>
      {state.status === "loading" ? (
        <View style={styles.list}>
          <Skeleton lines={5} />
        </View>
      ) : null}
      {state.status === "error" ? (
        <ErrorBlock message="Could not load customers" onRetry={props.onRetry} />
      ) : null}
      {state.status === "ready" && state.items.length === 0 ? (
        props.search.trim() === "" ? (
          <View>
            <EmptyBlock title="No customers yet" hint="Add your first member to get started." />
            <Button label="Add member" onPress={props.onAdd} />
          </View>
        ) : (
          <EmptyBlock
            title={`No one matches "${props.search.trim()}"`}
            hint="Check the spelling, or try their email or member number."
          />
        )
      ) : null}
      {state.status === "ready" && state.items.length > 0 ? (
        <FlatList
          data={state.items}
          keyExtractor={(row) => row.id}
          renderItem={({ item }) => <Card row={item} onOpen={props.onOpen} />}
          contentContainerStyle={styles.list}
          refreshing={props.refreshing}
          onRefresh={props.onRefresh}
          onEndReached={props.onEndReached}
          onEndReachedThreshold={0.5}
        />
      ) : null}
    </View>
  );
}
