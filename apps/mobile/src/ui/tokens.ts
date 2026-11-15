/** Fixed for every gym. Only the brand colour changes, and it paints buttons, links and focus only. */
export const DEFAULT_BRAND = "#2563EB";

/** The smallest tappable size, in points. */
export const MIN_TOUCH = 44;

export interface Tone {
  readonly background: string;
  readonly text: string;
  readonly border: string;
}

export const TONES = {
  ok: { background: "#E7F5EC", text: "#14532D", border: "#86C79A" },
  warn: { background: "#FEF3C7", text: "#713F12", border: "#E9B949" },
  bad: { background: "#FDE8E8", text: "#7F1D1D", border: "#EE9A9A" },
  off: { background: "#F1F2F4", text: "#374151", border: "#C4C8CF" },
} as const satisfies Record<string, Tone>;

export type ToneName = keyof typeof TONES;

export const SCAN_TONES = {
  welcome: { background: "#15803D", text: "#FFFFFF" },
  headsUp: { background: "#FACC15", text: "#422006" },
  overdue: { background: "#B91C1C", text: "#FFFFFF" },
  notActive: { background: "#4B5563", text: "#FFFFFF" },
} as const;

export const COLORS = {
  surface: "#FFFFFF",
  text: "#111827",
  textMuted: "#4B5563",
  border: "#E5E7EB",
  inputBorder: "#D1D5DB",
  avatar: "#F3F4F6",
  skeleton: "#E5E7EB",
  danger: "#7F1D1D",
  dangerBorder: "#EE9A9A",
  scrim: "rgba(17, 24, 39, 0.4)",
} as const;

export const RADII = { chip: 999, control: 10, card: 12, sheet: 20 } as const;
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20 } as const;
