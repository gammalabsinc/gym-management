import { createContext, type ReactNode, useContext } from "react";
import type { BrightnessLike } from "./brightness";
import type { CardService } from "./card";

export interface CardDeps {
  readonly service: CardService;
  readonly brightness: BrightnessLike;
}

const CardContext = createContext<CardDeps | null>(null);

export function CardProvider(props: { readonly deps: CardDeps; readonly children?: ReactNode }) {
  return <CardContext.Provider value={props.deps}>{props.children}</CardContext.Provider>;
}

export function useCardDeps(): CardDeps {
  const deps = useContext(CardContext);
  if (deps === null) throw new Error("useCardDeps needs a CardProvider above it");
  return deps;
}
