import { createContext, type ReactNode, useContext } from "react";
import type { AttendanceService } from "./attendance";

const AttendanceContext = createContext<AttendanceService | null>(null);

export function AttendanceProvider(props: {
  readonly service: AttendanceService;
  readonly children?: ReactNode;
}) {
  return (
    <AttendanceContext.Provider value={props.service}>{props.children}</AttendanceContext.Provider>
  );
}

export function useAttendanceService(): AttendanceService {
  const service = useContext(AttendanceContext);
  if (service === null)
    throw new Error("useAttendanceService needs an AttendanceProvider above it");
  return service;
}
