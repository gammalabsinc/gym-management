import { DEFAULT_BRAND } from "./tokens";

const HEX = /^#[0-9a-f]{6}$/i;

/** A brand colour from a gym's settings. Anything that is not a six digit hex falls back to the default. */
export function safeBrand(value: string | null | undefined): string {
  return value !== undefined && value !== null && HEX.test(value) ? value : DEFAULT_BRAND;
}

function channel(hex: string, start: number): number {
  const c = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a six digit hex colour. */
export function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** Black or white, whichever has the higher contrast on the given background. */
export function textOn(background: string): "#FFFFFF" | "#000000" {
  const l = luminance(background);
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? "#FFFFFF" : "#000000";
}
