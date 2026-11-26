import { createContext, useContext, useEffect } from "react";
import { Alert } from "react-native";

/** Tracks whether the visible screen has unsaved changes, so the tab bar can ask before leaving. */
export interface UnsavedGuard {
  setDirty(dirty: boolean): void;
  isDirty(): boolean;
}

export function createUnsavedGuard(): UnsavedGuard {
  let dirty = false;
  return {
    setDirty: (next) => {
      dirty = next;
    },
    isDirty: () => dirty,
  };
}

export const UnsavedGuardContext = createContext<UnsavedGuard>(createUnsavedGuard());

/** A screen with a form calls this with whether it has unsaved changes. */
export function useUnsavedGuard(dirty: boolean): void {
  const guard = useContext(UnsavedGuardContext);
  useEffect(() => {
    guard.setDirty(dirty);
    return () => guard.setDirty(false);
  }, [guard, dirty]);
}

/** Asks whether to throw the changes away. Resolves true when the person chooses to leave. */
export function confirmDiscard(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert("Discard changes?", "You have changes that are not saved.", [
      { text: "Keep editing", style: "cancel", onPress: () => resolve(false) },
      { text: "Discard", style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}

/** The tab name inside a navigation route key, which looks like `Settings-aBc123`. */
export function tabNameOfKey(key: string): string {
  const cut = key.lastIndexOf("-");
  return cut === -1 ? key : key.slice(0, cut);
}
