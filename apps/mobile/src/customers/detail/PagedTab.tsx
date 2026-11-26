import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "../../ui/Button";
import { EmptyBlock, ErrorBlock, Skeleton } from "../../ui/blocks";
import { SPACE } from "../../ui/tokens";
import type { PageLoader } from "./service";
import { useTab } from "./useTab";

const styles = StyleSheet.create({ list: { gap: SPACE.sm } });

/** One tab: loading, error, empty and its own pages. Mount it with a new key to load again. */
export function PagedTab<Row>(props: {
  readonly load: PageLoader<Row>;
  readonly emptyTitle: string;
  readonly emptyHint: string;
  readonly keyOf: (row: Row) => string;
  readonly render: (row: Row) => ReactNode;
}) {
  const { state, retry, more } = useTab(props.load);
  if (state.status === "loading") return <Skeleton lines={4} />;
  if (state.status === "error") return <ErrorBlock message={state.message} onRetry={retry} />;
  if (state.items.length === 0) {
    return <EmptyBlock title={props.emptyTitle} hint={props.emptyHint} />;
  }
  return (
    <View style={styles.list}>
      {state.items.map((row) => (
        <View key={props.keyOf(row)}>{props.render(row)}</View>
      ))}
      {state.nextCursor === null ? null : (
        <Button
          label={state.loadingMore ? "Loading" : "Load more"}
          kind="secondary"
          disabled={state.loadingMore}
          onPress={more}
        />
      )}
    </View>
  );
}
