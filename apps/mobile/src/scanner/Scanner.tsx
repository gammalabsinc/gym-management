import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckInSearch } from "./CheckInSearch";
import { useScannerDeps } from "./context";
import { ScannerScreen } from "./ScannerScreen";
import { ScanResultCard } from "./ScanResultCard";
import type { FirstCheckIn, ScanOutcome, SearchRow } from "./scan";
import { describeScan, type ShownScan } from "./scan-card";

type Phase =
  | { readonly kind: "scanning" }
  | { readonly kind: "sending" }
  | { readonly kind: "offline" }
  | { readonly kind: "result"; readonly outcome: ShownScan; readonly first: FirstCheckIn | null }
  | { readonly kind: "search" };

/**
 * One physical scan sends one request. The scanner is locked from the first read until the person
 * moves on, so a code held in front of the camera cannot send twice. The camera is released when the
 * screen loses focus. Nothing is queued when the network is down.
 */
export function Scanner() {
  const { service, camera } = useScannerDeps();
  const focused = useIsFocused();
  const permission = camera.usePermission();
  const [phase, setPhase] = useState<Phase>({ kind: "scanning" });
  const locked = useRef(false);
  const mounted = useRef(true);
  const { status, request } = permission;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Ask once. Asking again on every render would loop the system prompt.
  const asked = useRef(false);
  useEffect(() => {
    if (status === "undetermined" && !asked.current) {
      asked.current = true;
      request();
    }
  }, [status, request]);

  /** Shows what a recorded scan or check in came to. Both take the same road to the result card. */
  const finish = useCallback(
    async (outcome: ScanOutcome): Promise<void> => {
      if (outcome.status === "offline") {
        setPhase({ kind: "offline" });
        return;
      }
      // A repeat scan shows when the member first checked in. If that cannot be read the card still shows.
      const first =
        outcome.status === "recorded" && outcome.isDuplicate
          ? await service.firstCheckIn(outcome.memberId)
          : null;
      if (!mounted.current) return;
      setPhase({ kind: "result", outcome, first });
    },
    [service],
  );

  const onScan = useCallback(
    async (value: string): Promise<void> => {
      if (locked.current) return;
      locked.current = true;
      setPhase({ kind: "sending" });
      const outcome = await service.record(value);
      if (!mounted.current) return;
      await finish(outcome);
    },
    [service, finish],
  );

  /** A row chosen in the search. The list stays on screen with its buttons off until the answer comes. */
  const checkInRow = useCallback(
    async (row: SearchRow): Promise<void> => {
      if (locked.current) return;
      locked.current = true;
      const outcome = await service.record(row.barcode, "MANUAL");
      if (!mounted.current) return;
      await finish(outcome);
    },
    [service, finish],
  );

  const resume = useCallback(() => {
    locked.current = false;
    setPhase({ kind: "scanning" });
  }, []);

  if (phase.kind === "search") {
    return <CheckInSearch service={service} onCheckIn={checkInRow} onBack={resume} />;
  }

  const openSearch = () => setPhase({ kind: "search" });
  const base = {
    onSearch: openSearch,
    onOpenSettings: () => void camera.openSettings(),
    onRetry: resume,
  };

  if (phase.kind === "offline") return <ScannerScreen view={{ state: "offline" }} {...base} />;
  if (phase.kind === "result") {
    return <ScanResultCard view={describeScan(phase.outcome, phase.first)} onDone={resume} />;
  }
  if (status === "denied") return <ScannerScreen view={{ state: "denied" }} {...base} />;
  if (status !== "granted") return <ScannerScreen view={{ state: "waiting" }} {...base} />;
  return (
    <ScannerScreen
      view={{
        state: "scanning",
        camera: focused ? (
          <camera.Scanner
            paused={phase.kind !== "scanning"}
            onScan={(value) => void onScan(value)}
          />
        ) : null,
      }}
      {...base}
    />
  );
}
