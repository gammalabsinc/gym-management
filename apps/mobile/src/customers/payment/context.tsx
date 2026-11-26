import { createContext, type ReactNode, useContext } from "react";
import type { PaymentService } from "./service";

const PaymentContext = createContext<PaymentService | null>(null);

export function PaymentProvider(props: {
  readonly service: PaymentService;
  readonly children?: ReactNode;
}) {
  return <PaymentContext.Provider value={props.service}>{props.children}</PaymentContext.Provider>;
}

export function usePaymentService(): PaymentService {
  const service = useContext(PaymentContext);
  if (service === null) throw new Error("usePaymentService needs a PaymentProvider above it");
  return service;
}
