import { useCallback, useEffect, useRef, useState } from "react";
import type { CustomerRow, CustomersService } from "./list";

export type CustomersState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "ready";
      readonly items: readonly CustomerRow[];
      readonly nextCursor: string | null;
      readonly loadingMore: boolean;
    };

/** The search text, delayed until typing pauses. */
export function useDebounced(value: string, delayMs: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

/**
 * Loads the first page for a search term and further pages on request. Every request belongs to a
 * generation. A new search, a refresh or leaving the screen starts a new one, and an answer from an
 * older generation is dropped, so an older response can never overwrite a newer one.
 */
export function useCustomers(service: CustomersService, search: string) {
  const [state, setState] = useState<CustomersState>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);

  const load = useCallback(
    async (refresh: boolean): Promise<void> => {
      generation.current += 1;
      const mine = generation.current;
      if (refresh) setRefreshing(true);
      else setState({ status: "loading" });
      const page = await service.fetch({ search });
      if (mine !== generation.current) return;
      setRefreshing(false);
      setState(
        page.status === "page"
          ? { status: "ready", items: page.items, nextCursor: page.nextCursor, loadingMore: false }
          : { status: "error", message: page.message },
      );
    },
    [service, search],
  );

  useEffect(() => {
    void load(false);
    return () => {
      generation.current += 1;
    };
  }, [load]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (state.status !== "ready" || state.nextCursor === null || state.loadingMore) return;
    const mine = generation.current;
    const cursor = state.nextCursor;
    setState({ ...state, loadingMore: true });
    const page = await service.fetch({ search, cursor });
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
  }, [service, search, state]);

  return {
    state,
    refreshing,
    loadMore: () => void loadMore(),
    refresh: () => void load(true),
    retry: () => void load(false),
  };
}
