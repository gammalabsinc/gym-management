import { createContext, type ReactNode, useContext } from "react";
import type { DetailService } from "./service";

const DetailContext = createContext<DetailService | null>(null);

export function DetailProvider(props: {
  readonly service: DetailService;
  readonly children?: ReactNode;
}) {
  return <DetailContext.Provider value={props.service}>{props.children}</DetailContext.Provider>;
}

export function useDetailService(): DetailService {
  const service = useContext(DetailContext);
  if (service === null) throw new Error("useDetailService needs a DetailProvider above it");
  return service;
}
