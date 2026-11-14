// Minimal stand in for react-native, so component tests run in jsdom without the native runtime.
import type { ReactNode } from "react";

interface Props {
  readonly children?: ReactNode;
  readonly testID?: string;
}

export function View(props: Props) {
  return <div data-testid={props.testID}>{props.children}</div>;
}

export function Text(props: Props) {
  return <span data-testid={props.testID}>{props.children}</span>;
}

export const StyleSheet = { create: <T,>(styles: T): T => styles };
