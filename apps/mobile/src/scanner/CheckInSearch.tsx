import { useCallback, useEffect, useRef, useState } from "react";
import { useDebounced } from "../customers/useCustomers";
import { CheckInSearchScreen, type SearchState } from "./CheckInSearchScreen";
import type { ScanService, SearchRow } from "./scan";

export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Searches as the person types, after a short pause. Every search belongs to a generation, so an
 * answer to older text is dropped. One check in runs at a time: the buttons are disabled while it is
 * in flight, and a second tap before the screen redraws is ignored, so a double tap makes one visit.
 */
export function CheckInSearch(props: {
  readonly service: Pick<ScanService, "search">;
  /** Records the check in and moves on to the result card. Resolves when the request is done. */
  readonly onCheckIn: (row: SearchRow) => Promise<void>;
  readonly onBack: () => void;
}) {
  const { service, onCheckIn } = props;
  const [text, setText] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const [checkingIn, setCheckingIn] = useState<string | null>(null);
  const settled = useDebounced(text, SEARCH_DEBOUNCE_MS);
  const generation = useRef(0);
  const busy = useRef(false);
  const mounted = useRef(true);

  const run = useCallback(
    async (term: string): Promise<void> => {
      generation.current += 1;
      const mine = generation.current;
      if (term.trim() === "") {
        setState({ status: "idle" });
        return;
      }
      setState({ status: "loading" });
      const result = await service.search(term);
      if (mine !== generation.current) return;
      setState(result);
    },
    [service],
  );

  useEffect(() => {
    void run(settled);
  }, [run, settled]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  const checkIn = async (row: SearchRow): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    setCheckingIn(row.memberId);
    await onCheckIn(row);
    busy.current = false;
    if (mounted.current) setCheckingIn(null);
  };

  return (
    <CheckInSearchScreen
      text={text}
      state={state}
      checkingIn={checkingIn}
      onText={setText}
      onCheckIn={(row) => void checkIn(row)}
      onRetry={() => void run(text)}
      onBack={props.onBack}
    />
  );
}
