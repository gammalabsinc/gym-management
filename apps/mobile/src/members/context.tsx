import { createContext, type ReactNode, useContext } from "react";
import type { MembersService } from "./service";

const MembersContext = createContext<MembersService | null>(null);

export function MembersProvider(props: {
  readonly service: MembersService;
  readonly children?: ReactNode;
}) {
  return <MembersContext.Provider value={props.service}>{props.children}</MembersContext.Provider>;
}

export function useMembersService(): MembersService {
  const service = useContext(MembersContext);
  if (service === null) throw new Error("useMembersService needs a MembersProvider above it");
  return service;
}
