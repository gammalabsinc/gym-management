import { StyleSheet, Text, View } from "react-native";
import { RADII, SPACE, TONES, type ToneName } from "./tokens";

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: SPACE.sm,
    paddingVertical: 2,
    borderRadius: RADII.chip,
    borderWidth: 1,
  },
  label: { fontSize: 12, fontWeight: "600" },
});

/** The one chip. Colours come from the fixed tones, never from the gym brand. */
export function Chip(props: { readonly label: string; readonly tone: ToneName }) {
  const tone = TONES[props.tone];
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={props.label}
      style={[styles.chip, { backgroundColor: tone.background, borderColor: tone.border }]}
    >
      <Text style={[styles.label, { color: tone.text }]}>{props.label}</Text>
    </View>
  );
}

export const MEMBER_STATUSES = {
  paid: { label: "Paid", tone: "ok" },
  due_soon: { label: "Due soon", tone: "warn" },
  overdue: { label: "Overdue", tone: "bad" },
  paused: { label: "Paused", tone: "off" },
  cancelled: { label: "Cancelled", tone: "off" },
} as const satisfies Record<string, { label: string; tone: ToneName }>;

export const INVOICE_STATUSES = {
  paid: { label: "Paid", tone: "ok" },
  unpaid: { label: "Unpaid", tone: "bad" },
  upcoming: { label: "Upcoming", tone: "off" },
  voided: { label: "Voided", tone: "off" },
} as const satisfies Record<string, { label: string; tone: ToneName }>;

export const DISCOUNT_STATUSES = {
  active: { label: "Active", tone: "ok" },
  used: { label: "Used", tone: "off" },
  ended: { label: "Ended", tone: "off" },
} as const satisfies Record<string, { label: string; tone: ToneName }>;

export function StatusChip(props: { readonly status: keyof typeof MEMBER_STATUSES }) {
  return <Chip {...MEMBER_STATUSES[props.status]} />;
}

export function InvoiceBadge(props: { readonly status: keyof typeof INVOICE_STATUSES }) {
  return <Chip {...INVOICE_STATUSES[props.status]} />;
}

export function DiscountChip(props: { readonly status: keyof typeof DISCOUNT_STATUSES }) {
  return <Chip {...DISCOUNT_STATUSES[props.status]} />;
}
