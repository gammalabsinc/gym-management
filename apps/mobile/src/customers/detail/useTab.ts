import { useCallback, useEffect, useRef, useState } from "react";
import type { PageLoader } from "./service";

export type TabState<Row> =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "ready";
      readonly items: readonly Row[];
      readonly nextCursor: string | null;
      readonly loadingMore: boolean;
    };

/**
 * One tab's pages. Every request belongs to a generation: reloading, leaving the tab or asking for a
 * different customer starts a new one, and an answer from an older generation is dropped. The tab is
 * mounted again with a new key to load from the server after a change, nothing is patched locally.
 */
export function useTab<Row>(load: PageLoader<Row>) {
  const [state, setState] = useState<TabState<Row>>({ status: "loading" });
  const generation = useRef(0);

  const first = useCallback(async (): Promise<void> => {
    generation.current += 1;
    const mine = generation.current;
    setState({ status: "loading" });
    const page = await load();
    if (mine !== generation.current) return;
    setState(
      page.status === "page"
        ? { status: "ready", items: page.items, nextCursor: page.nextCursor, loadingMore: false }
        : { status: "error", message: page.message },
    );
  }, [load]);

  useEffect(() => {
    void first();
    return () => {
      generation.current += 1;
    };
  }, [first]);

  const more = useCallback(async (): Promise<void> => {
    if (state.status !== "ready" || state.nextCursor === null || state.loadingMore) return;
    const mine = generation.current;
    setState({ ...state, loadingMore: true });
    const page = await load(state.nextCursor);
    if (mine !== generation.current) return;
    setState((current) => {
      if (current.status !== "ready") return current;
      return page.status === "page"
        ? {
            status: "ready",
            items: [...current.items, ...page.items],
            nextCursor: page.nextCursor,
            loadingMore: false,
          }
        : { ...current, loadingMore: false };
    });
  }, [load, state]);

  return { state, retry: () => void first(), more: () => void more() };
}
