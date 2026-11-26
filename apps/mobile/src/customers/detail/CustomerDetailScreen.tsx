import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { cardStatus } from "../../card/present";
import { Button } from "../../ui/Button";
import { StatusChip } from "../../ui/chips";
import { formatDate } from "../../ui/dates";
import { formatMoney } from "../../ui/money";
import { COLORS, MIN_TOUCH, RADII, SPACE } from "../../ui/tokens";
import type { DetailHeader } from "./service";

export const TABS = ["Invoices", "Payments", "Visits", "Discounts", "History"] as const;
export type TabName = (typeof TABS)[number];

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F9FAFB" },
  content: { padding: SPACE.xl, gap: SPACE.lg },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { fontSize: 22, fontWeight: "800", color: COLORS.text },
  sub: { fontSize: 14, color: COLORS.textMuted },
  figures: { gap: SPACE.xs },
  figure: { fontSize: 14, color: COLORS.textMuted },
  value: { fontWeight: "700", color: COLORS.text },
  row: { flexDirection: "row", gap: SPACE.sm, flexWrap: "wrap" },
  tabs: { flexDirection: "row", gap: SPACE.sm, flexWrap: "wrap" },
  tab: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: SPACE.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: RADII.control,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  tabOn: { borderColor: COLORS.text },
  tabText: { fontSize: 14, color: COLORS.textMuted },
  tabTextOn: { fontWeight: "700", color: COLORS.text },
  banner: { fontSize: 14, color: COLORS.danger },
  notice: { fontSize: 14, color: COLORS.textMuted },
});

/** A3: the customer header, its five tabs and the more actions. The open tab is `children`. */
export function CustomerDetailScreen(props: {
  readonly header: DetailHeader;
  readonly tab: TabName;
  readonly banner: string | null;
  /** Good news that needs saying, such as when a new discount starts to count. */
  readonly notice: string | null;
  readonly actionsOpen: boolean;
  readonly onTab: (tab: TabName) => void;
  readonly onBack: () => void;
  readonly onRecordPayment: () => void;
  readonly onToggleActions: () => void;
  readonly onEdit: () => void;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onCancel: () => void;
  readonly children?: ReactNode;
}) {
  const { header } = props;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.top}>
        <Button label="Back to customers" kind="secondary" onPress={props.onBack} />
      </View>
      <View style={styles.figures}>
        <Text style={styles.name}>{header.name ?? "Customer"}</Text>
        <Text style={styles.sub}>
          Member {header.memberNo}, {header.planName}
        </Text>
        <StatusChip status={cardStatus(header)} />
        <Text style={styles.figure}>
          Balance due{" "}
          <Text style={styles.value}>{formatMoney(header.balanceDue, header.currency)}</Text>
        </Text>
        <Text style={styles.figure}>
          Paid through{" "}
          <Text style={styles.value}>
            {header.paidThrough === null ? "Not paid yet" : formatDate(header.paidThrough)}
          </Text>
        </Text>
        <Text style={styles.figure}>
          Credit <Text style={styles.value}>{formatMoney(header.credit, header.currency)}</Text>
        </Text>
      </View>
      {props.banner === null ? null : (
        <Text accessibilityRole="alert" style={styles.banner}>
          {props.banner}
        </Text>
      )}
      {props.notice === null ? null : (
        <Text accessibilityRole="summary" style={styles.notice}>
          {props.notice}
        </Text>
      )}
      <View style={styles.row}>
        <Button label="Record payment" onPress={props.onRecordPayment} />
        <Button label="More actions" kind="secondary" onPress={props.onToggleActions} />
      </View>
      {props.actionsOpen ? (
        <View style={styles.row}>
          <Button label="Edit" kind="secondary" onPress={props.onEdit} />
          {header.status === "ACTIVE" ? (
            <Button label="Pause" kind="secondary" onPress={props.onPause} />
          ) : null}
          {header.status === "PAUSED" ? (
            <Button label="Resume" kind="secondary" onPress={props.onResume} />
          ) : null}
          {header.status === "CANCELLED" ? null : (
            <Button label="Cancel membership" kind="danger" onPress={props.onCancel} />
          )}
        </View>
      ) : null}
      <View accessibilityRole="tablist" style={styles.tabs}>
        {TABS.map((name) => (
          <Pressable
            key={name}
            accessibilityRole="tab"
            accessibilityState={{ selected: name === props.tab }}
            onPress={() => props.onTab(name)}
            style={[styles.tab, name === props.tab ? styles.tabOn : null]}
          >
            <Text style={[styles.tabText, name === props.tab ? styles.tabTextOn : null]}>
              {name}
            </Text>
          </Pressable>
        ))}
      </View>
      {props.children}
    </ScrollView>
  );
}
