import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { initials } from "../ui/dates";
import { SCAN_TONES } from "../ui/tokens";
import type { CardGlyph, CardTone, ScanCardView } from "./scan-card";

/** The card goes back to scanning by itself after this long. No state waits for a tap. */
export const RESULT_MS = 3000;
export const TICK_MS = 100;

const COLORS_BY_TONE = {
  welcome: SCAN_TONES.welcome,
  headsUp: SCAN_TONES.headsUp,
  overdue: SCAN_TONES.overdue,
  neutral: SCAN_TONES.notActive,
} as const satisfies Record<CardTone, { readonly background: string; readonly text: string }>;

const GLYPHS: Readonly<Record<CardGlyph, string>> = {
  check: "✓",
  alert: "!",
  dash: "–",
  help: "?",
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  tap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18, padding: 28 },
  icon: {
    width: 96,
    height: 96,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
  },
  glyph: { fontSize: 52, fontWeight: "800" },
  title: { fontSize: 44, fontWeight: "800", textAlign: "center" },
  member: { alignItems: "center", gap: 10, marginTop: 6 },
  initials: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  initialsText: { fontSize: 34, fontWeight: "700", color: "#111827" },
  name: { fontSize: 30, fontWeight: "700", textAlign: "center" },
  line: { fontSize: 20, fontWeight: "500", textAlign: "center" },
  note: {
    marginTop: 6,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    fontSize: 19,
    fontWeight: "600",
    textAlign: "center",
  },
  footer: { paddingHorizontal: 24, paddingBottom: 34, gap: 12, alignItems: "center" },
  track: {
    width: "100%",
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.25)",
    overflow: "hidden",
  },
  hint: { fontSize: 15, fontWeight: "500" },
});

/** Counts down in small steps and calls `onDone` once, when the time is up. */
function useCountdown(totalMs: number, onDone: () => void): number {
  const [elapsed, setElapsed] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const timer = setInterval(() => setElapsed((value) => value + TICK_MS), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const finished = elapsed >= totalMs;
  useEffect(() => {
    if (finished) done.current();
  }, [finished]);

  return Math.max(0, totalMs - elapsed);
}

/**
 * A1b: the full screen result of a scan. It is announced when it appears, goes back to scanning after
 * three seconds and also on a tap. Nothing is asked of the person, so no state blocks entry.
 */
export function ScanResultCard(props: {
  readonly view: ScanCardView;
  readonly onDone: () => void;
}) {
  const { view } = props;
  const remaining = useCountdown(RESULT_MS, props.onDone);
  const colors = COLORS_BY_TONE[view.tone];
  const seconds = Math.ceil(remaining / 1000);
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <Pressable
        accessibilityLabel={`${view.title}. Tap to scan the next member.`}
        onPress={props.onDone}
        style={styles.tap}
      >
        <View
          style={[
            styles.icon,
            { borderColor: colors.text, borderRadius: view.shape === "circle" ? 48 : 22 },
          ]}
        >
          <Text style={[styles.glyph, { color: colors.text }]}>{GLYPHS[view.glyph]}</Text>
        </View>
        <Text style={[styles.title, { color: colors.text }]}>{view.title}</Text>
        {view.name === null ? null : (
          <View style={styles.member}>
            <View accessibilityLabel="Member initials" style={styles.initials}>
              <Text style={styles.initialsText}>{initials(view.name)}</Text>
            </View>
            <Text style={[styles.name, { color: colors.text }]}>{view.name}</Text>
            {view.line === null ? null : (
              <Text style={[styles.line, { color: colors.text }]}>{view.line}</Text>
            )}
          </View>
        )}
        {view.note === null ? null : (
          <Text style={[styles.note, { color: colors.text }]}>{view.note}</Text>
        )}
      </Pressable>
      <View style={styles.footer}>
        <View style={styles.track}>
          <View
            testID="countdown"
            style={{
              width: `${Math.round((remaining / RESULT_MS) * 100)}%`,
              height: 6,
              borderRadius: 999,
              backgroundColor: colors.text,
            }}
          />
        </View>
        <Text style={[styles.hint, { color: colors.text }]}>
          {`Back to scanning in ${seconds} ${seconds === 1 ? "second" : "seconds"}. Tap to skip.`}
        </Text>
      </View>
    </View>
  );
}
