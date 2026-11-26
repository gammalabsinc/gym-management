import { createContext, type ReactNode, useContext } from "react";
import type { SettingsService } from "./service";

const SettingsContext = createContext<SettingsService | null>(null);

export function SettingsProvider(props: {
  readonly service: SettingsService;
  readonly children?: ReactNode;
}) {
  return (
    <SettingsContext.Provider value={props.service}>{props.children}</SettingsContext.Provider>
  );
}

export function useSettingsService(): SettingsService {
  const service = useContext(SettingsContext);
  if (service === null) throw new Error("useSettingsService needs a SettingsProvider above it");
  return service;
}
