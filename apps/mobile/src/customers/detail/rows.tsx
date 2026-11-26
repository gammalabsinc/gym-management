import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "../../ui/Button";
import { Chip, DiscountChip, InvoiceBadge } from "../../ui/chips";
import { formatDate, formatDateTime } from "../../ui/dates";
import { formatMoney } from "../../ui/money";
import { COLORS, SPACE } from "../../ui/tokens";
import type {
  DiscountRow,
  HistoryRow,
  InvoiceRow,
  MemberStatus,
  PaymentRow,
  VisitRow,
} from "./service";

const styles = StyleSheet.create({
  card: {
    gap: SPACE.sm,
    padding: SPACE.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: SPACE.md,
  },
  title: { flex: 1, fontSize: 15, fontWeight: "700", color: COLORS.text },
  line: { fontSize: 13, color: COLORS.textMuted },
});

function Card(props: {
  readonly title: string;
  readonly chip: ReactNode;
  readonly lines: readonly (string | null)[];
  readonly children?: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Text style={styles.title}>{props.title}</Text>
        {props.chip}
      </View>
      {props.lines.map((line) =>
        line === null ? null : (
          <Text key={line} style={styles.line}>
            {line}
          </Text>
        ),
      )}
      {props.children}
    </View>
  );
}

export function InvoiceCard(props: {
  readonly row: InvoiceRow;
  readonly currency: string;
  /** Owners only, and only while no payment is applied. */
  readonly onVoid: (() => void) | null;
}) {
  const { row } = props;
  const status = row.isVoid ? "voided" : row.isPaid ? "paid" : "unpaid";
  return (
    <Card
      title={`${formatDate(row.periodStart)} to ${formatDate(row.periodEnd)}`}
      chip={<InvoiceBadge status={status} />}
      lines={[
        `Total ${formatMoney(row.total, props.currency)}, due ${formatMoney(row.amountDue, props.currency)}`,
        `Due date ${formatDate(row.dueDate)}`,
        row.isVoid && row.voidReason !== null ? `Voided: ${row.voidReason}` : null,
      ]}
    >
      {props.onVoid === null ? null : (
        <Button
          label={`Void invoice due ${formatDate(row.dueDate)}`}
          kind="danger"
          onPress={props.onVoid}
        />
      )}
    </Card>
  );
}

const METHODS = { CASH: "Cash", CARD: "Card", BANK_TRANSFER: "Bank transfer" } as const;

export function PaymentCard(props: {
  readonly row: PaymentRow;
  readonly currency: string;
  readonly onVoid: (() => void) | null;
}) {
  const { row } = props;
  return (
    <Card
      title={`${formatMoney(row.amount, props.currency)} by ${METHODS[row.method]}`}
      chip={row.isVoid ? <InvoiceBadge status="voided" /> : null}
      lines={[
        `Received ${formatDate(row.paidOn)}`,
        row.isVoid && row.voidReason !== null ? `Voided: ${row.voidReason}` : null,
      ]}
    >
      {props.onVoid === null ? null : (
        <Button
          label={`Void payment of ${formatDate(row.paidOn)}`}
          kind="danger"
          onPress={props.onVoid}
        />
      )}
    </Card>
  );
}

export function VisitCard(props: { readonly row: VisitRow; readonly timezone: string }) {
  const { row } = props;
  return (
    <Card
      title={formatDateTime(row.scannedAt, props.timezone)}
      chip={row.isDuplicate ? <Chip label="Repeat scan" tone="off" /> : null}
      lines={[row.source === "MANUAL" ? "Checked in from a search" : "Scanned at the desk"]}
    />
  );
}

export function DiscountCard(props: { readonly row: DiscountRow; readonly currency: string }) {
  const { row } = props;
  const status = row.isActive ? "active" : row.isConsumed ? "used" : "ended";
  return (
    <Card
      title={`${formatMoney(row.amount, props.currency)} off, ${row.isRecurring ? "every month" : "one time"}`}
      chip={<DiscountChip status={status} />}
      lines={[
        row.kind === "REFERRAL" ? "Referral discount" : "Manual discount",
        row.reason,
        `From ${formatDate(row.startsOn)}${row.endsOn === null ? "" : ` to ${formatDate(row.endsOn)}`}`,
      ]}
    />
  );
}

const STATUS_LABELS: Readonly<Record<MemberStatus, string>> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  CANCELLED: "Cancelled",
};

export function HistoryCard(props: { readonly row: HistoryRow }) {
  const { row } = props;
  return (
    <Card
      title={STATUS_LABELS[row.status]}
      chip={row.validTo === null ? <Chip label="Current" tone="ok" /> : null}
      lines={[
        `From ${formatDate(row.validFrom)}${row.validTo === null ? "" : ` to ${formatDate(row.validTo)}`}`,
        row.reason,
      ]}
    />
  );
}
