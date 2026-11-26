// Minimal stand in for react-native, so component tests run in jsdom without the native runtime.
import type { ReactNode } from "react";

type Style = object | readonly Style[] | null | undefined | false;

interface Props {
  readonly children?: ReactNode;
  readonly testID?: string;
  readonly style?: Style;
  readonly accessibilityRole?: string;
  readonly accessibilityLabel?: string;
  readonly accessibilityState?: object;
}

function flatten(style: Style): object {
  if (!style) return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  return style;
}

function shared(props: Props) {
  return {
    "data-testid": props.testID,
    "data-style": JSON.stringify(flatten(props.style)),
    "data-role": props.accessibilityRole,
    "aria-label": props.accessibilityLabel,
    "data-state":
      props.accessibilityState === undefined ? undefined : JSON.stringify(props.accessibilityState),
  };
}

export function View(props: Props) {
  return <div {...shared(props)}>{props.children}</div>;
}

export function ScrollView(props: Props) {
  return <div {...shared(props)}>{props.children}</div>;
}

export function Text(props: Props) {
  return <span {...shared(props)}>{props.children}</span>;
}

export function Pressable(
  props: Props & { readonly onPress?: () => void; readonly disabled?: boolean },
) {
  return (
    <button type="button" {...shared(props)} disabled={props.disabled} onClick={props.onPress}>
      {props.children}
    </button>
  );
}

export function TextInput(
  props: Props & {
    readonly value?: string;
    readonly onChangeText?: (text: string) => void;
    readonly onFocus?: () => void;
    readonly onBlur?: () => void;
    readonly placeholder?: string;
  },
) {
  return (
    <input
      {...shared(props)}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(event) => props.onChangeText?.(event.target.value)}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
    />
  );
}

export function Modal(
  props: Props & { readonly visible: boolean; readonly onRequestClose?: () => void },
) {
  return props.visible ? <div {...shared(props)}>{props.children}</div> : null;
}

export const StyleSheet = { create: <T,>(styles: T): T => styles };

export const Linking = { openSettings: async (): Promise<void> => undefined };

/** Renders every row. Pull to refresh and end reached show as buttons, so tests can trigger them. */
export function FlatList<T>(props: {
  readonly data: readonly T[];
  readonly keyExtractor: (item: T) => string;
  readonly renderItem: (info: { item: T }) => ReactNode;
  readonly onRefresh?: () => void;
  readonly onEndReached?: () => void;
  readonly refreshing?: boolean;
  readonly contentContainerStyle?: Style;
}) {
  return (
    <div data-testid="list" data-refreshing={String(props.refreshing === true)}>
      <button type="button" aria-label="Pull to refresh" onClick={props.onRefresh} />
      {props.data.map((item) => (
        <div key={props.keyExtractor(item)}>{props.renderItem({ item })}</div>
      ))}
      <button type="button" aria-label="Reach the end" onClick={props.onEndReached} />
    </div>
  );
}

export const Alert = {
  alert: (_title: string, _message?: string, _buttons?: readonly unknown[]): void => {},
};
