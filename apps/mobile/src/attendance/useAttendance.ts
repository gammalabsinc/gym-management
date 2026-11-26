import { useCallback, useEffect, useRef, useState } from "react";
import type { AttendanceService, VisitRow } from "./attendance";

export type AttendanceState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "ready";
      readonly memberId: string;
      readonly timezone: string;
      readonly visitsThisMonth: number;
      readonly visitsLastMonth: number;
      readonly items: readonly VisitRow[];
      readonly nextCursor: string | null;
      readonly loadingMore: boolean;
      /** The last request for older visits failed. The visits already shown stay. */
      readonly moreFailed: boolean;
    };

/**
 * Loads the counts and the newest visits, then older visits on request. Every request belongs to a
 * generation. Reloading or leaving the screen starts a new one, and an answer from an older
 * generation is dropped.
 */
export function useAttendance(service: AttendanceService) {
  const [state, setState] = useState<AttendanceState>({ status: "loading" });
  const generation = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    generation.current += 1;
    const mine = generation.current;
    setState({ status: "loading" });
    const first = await service.first();
    if (mine !== generation.current) return;
    setState(
      first.status === "ready"
        ? { ...first, loadingMore: false, moreFailed: false }
        : { status: "error", message: first.message },
    );
  }, [service]);

  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (state.status !== "ready" || state.nextCursor === null || state.loadingMore) return;
    const mine = generation.current;
    const { memberId, nextCursor } = state;
    setState({ ...state, loadingMore: true, moreFailed: false });
    const page = await service.more(memberId, nextCursor);
    if (mine !== generation.current) return;
    setState((current) => {
      if (current.status !== "ready") return current;
      return page.status === "page"
        ? {
            ...current,
            items: [...current.items, ...page.items],
            nextCursor: page.nextCursor,
            loadingMore: false,
          }
        : { ...current, loadingMore: false, moreFailed: true };
    });
  }, [service, state]);

  return { state, loadMore: () => void loadMore(), retry: () => void load() };
}
