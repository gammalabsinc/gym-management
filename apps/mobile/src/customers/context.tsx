import { createContext, type ReactNode, useContext } from "react";
import type { CustomersService } from "./list";

const CustomersContext = createContext<CustomersService | null>(null);

export function CustomersProvider(props: {
  readonly service: CustomersService;
  readonly children?: ReactNode;
}) {
  return (
    <CustomersContext.Provider value={props.service}>{props.children}</CustomersContext.Provider>
  );
}

export function useCustomersService(): CustomersService {
  const service = useContext(CustomersContext);
  if (service === null) throw new Error("useCustomersService needs a CustomersProvider above it");
  return service;
}
