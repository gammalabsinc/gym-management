import { StyleSheet, Text, View } from "react-native";
import { Button } from "../ui/Button";
import { BrandProvider } from "../ui/brand";
import { StatusChip } from "../ui/chips";
import { formatDateTime } from "../ui/dates";
import { COLORS, SPACE, TONES } from "../ui/tokens";
import type { CachedCard } from "./cache";
import { cardStatus, statusLine } from "./present";
import { QrCode } from "./QrCode";

const styles = StyleSheet.create({
  container: { flex: 1, padding: SPACE.xl, gap: SPACE.lg },
  gym: { fontSize: 18, fontWeight: "700", color: COLORS.text },
  name: { fontSize: 24, fontWeight: "700", color: COLORS.text },
  number: { fontSize: 15, color: COLORS.textMuted },
  line: { fontSize: 15, color: COLORS.text },
  offline: {
    padding: SPACE.md,
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: TONES.warn.background,
    borderColor: TONES.warn.border,
  },
  offlineText: { fontSize: 13, color: TONES.warn.text },
  links: { flexDirection: "row", gap: SPACE.md },
});

/** M4. The same layout for fresh and offline cards. An offline card says when it was last updated. */
export function MemberCardScreen(props: {
  readonly cached: CachedCard;
  readonly offline: boolean;
  readonly onOpenAttendance: () => void;
  readonly onOpenProfile: () => void;
}) {
  const { card, updatedAt } = props.cached;
  return (
    <BrandProvider color={card.brandColor}>
      <View style={styles.container}>
        <Text style={styles.gym}>{card.gymName}</Text>
        {props.offline ? (
          <View accessibilityRole="alert" style={styles.offline}>
            <Text style={styles.offlineText}>
              Offline. Last updated {formatDateTime(updatedAt, card.timezone)}.
            </Text>
          </View>
        ) : null}
        <QrCode value={card.barcode} />
        <Text style={styles.name}>{card.name ?? "Member"}</Text>
        <Text style={styles.number}>Member {card.memberNo}</Text>
        <StatusChip status={cardStatus(card)} />
        <Text style={styles.line}>{statusLine(card)}</Text>
        <View style={styles.links}>
          <Button label="Attendance" kind="secondary" onPress={props.onOpenAttendance} />
          <Button label="Profile" kind="secondary" onPress={props.onOpenProfile} />
        </View>
      </View>
    </BrandProvider>
  );
}
