import { createContext, type ReactNode, useContext } from "react";
import type { StaffService } from "./service";

const StaffContext = createContext<StaffService | null>(null);

export function StaffProvider(props: {
  readonly service: StaffService;
  readonly children?: ReactNode;
}) {
  return <StaffContext.Provider value={props.service}>{props.children}</StaffContext.Provider>;
}

export function useStaffService(): StaffService {
  const service = useContext(StaffContext);
  if (service === null) throw new Error("useStaffService needs a StaffProvider above it");
  return service;
}
