import { createContext, type ReactNode, useContext } from "react";
import type { CameraPort } from "./camera";
import type { ScanService } from "./scan";

export interface ScannerDeps {
  readonly service: ScanService;
  readonly camera: CameraPort;
}

const ScannerContext = createContext<ScannerDeps | null>(null);

export function ScannerProvider(props: {
  readonly deps: ScannerDeps;
  readonly children?: ReactNode;
}) {
  return <ScannerContext.Provider value={props.deps}>{props.children}</ScannerContext.Provider>;
}

export function useScannerDeps(): ScannerDeps {
  const deps = useContext(ScannerContext);
  if (deps === null) throw new Error("useScannerDeps needs a ScannerProvider above it");
  return deps;
}
