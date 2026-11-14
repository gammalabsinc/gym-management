import { createContext, type ReactNode, useContext } from "react";
import type { RuntimeConfig } from "./build-config";

const ConfigContext = createContext<RuntimeConfig | null>(null);

export function ConfigProvider(props: {
  readonly config: RuntimeConfig;
  readonly children?: ReactNode;
}) {
  return <ConfigContext.Provider value={props.config}>{props.children}</ConfigContext.Provider>;
}

export function useConfig(): RuntimeConfig {
  const config = useContext(ConfigContext);
  if (config === null) throw new Error("useConfig must be used inside ConfigProvider");
  return config;
}
