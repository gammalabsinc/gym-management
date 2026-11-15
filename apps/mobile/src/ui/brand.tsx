import { createContext, type ReactNode, useContext, useMemo } from "react";
import { safeBrand, textOn } from "./contrast";
import { DEFAULT_BRAND } from "./tokens";

export interface Brand {
  readonly color: string;
  /** Black or white, picked by contrast on the brand colour. */
  readonly onColor: string;
}

const BrandContext = createContext<Brand>({ color: DEFAULT_BRAND, onColor: textOn(DEFAULT_BRAND) });

/** Supplies the gym's brand colour. An invalid or missing value uses the default. */
export function BrandProvider(props: {
  readonly color?: string | null;
  readonly children?: ReactNode;
}) {
  const color = safeBrand(props.color);
  const brand = useMemo(() => ({ color, onColor: textOn(color) }), [color]);
  return <BrandContext.Provider value={brand}>{props.children}</BrandContext.Provider>;
}

export function useBrand(): Brand {
  return useContext(BrandContext);
}
