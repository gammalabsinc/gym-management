import { useEffect } from "react";

/** The part of expo-brightness used here. */
export interface BrightnessLike {
  getBrightnessAsync(): Promise<number>;
  setBrightnessAsync(value: number): Promise<void>;
}

/** Full brightness while the component is mounted, then the old level again. Failures are ignored. */
export function useFullBrightness(brightness: BrightnessLike): void {
  useEffect(() => {
    let previous: number | null = null;
    let closed = false;
    (async () => {
      try {
        const before = await brightness.getBrightnessAsync();
        if (closed) return;
        previous = before;
        await brightness.setBrightnessAsync(1);
      } catch {
        // The card is readable at any brightness.
      }
    })();
    return () => {
      closed = true;
      if (previous !== null) void brightness.setBrightnessAsync(previous).catch(() => {});
    };
  }, [brightness]);
}
