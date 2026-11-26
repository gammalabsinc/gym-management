import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { PlaceholderScreen } from "../screens/PlaceholderScreen";
import { Button } from "../ui/Button";
import { formatDate } from "../ui/dates";
import { useScannerDeps } from "./context";
import { ScannerScreen } from "./ScannerScreen";
import type { ScanOutcome } from "./scan";

type Phase =
  | { readonly kind: "scanning" }
  | { readonly kind: "sending" }
  | { readonly kind: "offline" }
  | { readonly kind: "result"; readonly outcome: ScanOutcome }
  | { readonly kind: "search" };

function resultText(outcome: ScanOutcome): { title: string; detail: string | null } {
  switch (outcome.status) {
    case "recorded": {
      const name = outcome.memberName ?? "Member";
      if (outcome.isDuplicate) return { title: "Already checked in", detail: name };
      const through =
        outcome.paidThrough === null ? null : `Paid through ${formatDate(outcome.paidThrough)}`;
      return { title: "Checked in", detail: through === null ? name : `${name}. ${through}.` };
    }
    case "notRecognized":
      return { title: "Barcode not recognized", detail: "Try again, or search by name." };
    case "failed":
      return { title: "Could not check in", detail: outcome.message };
    case "offline":
      return { title: "No connection", detail: null };
  }
}

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

  const onScan = useCallback(
    async (value: string): Promise<void> => {
      if (locked.current) return;
      locked.current = true;
      setPhase({ kind: "sending" });
      const outcome = await service.record(value);
      if (!mounted.current) return;
      setPhase(outcome.status === "offline" ? { kind: "offline" } : { kind: "result", outcome });
    },
    [service],
  );

  const resume = useCallback(() => {
    locked.current = false;
    setPhase({ kind: "scanning" });
  }, []);

  if (phase.kind === "search") {
    return (
      <>
        <PlaceholderScreen title="Check in by search" />
        <Button label="Back to scanner" kind="secondary" onPress={resume} />
      </>
    );
  }

  const openSearch = () => setPhase({ kind: "search" });
  const base = {
    onSearch: openSearch,
    onOpenSettings: () => void camera.openSettings(),
    onRetry: resume,
  };

  if (phase.kind === "offline") return <ScannerScreen view={{ state: "offline" }} {...base} />;
  if (phase.kind === "result") {
    return <ScannerScreen view={{ state: "result", ...resultText(phase.outcome) }} {...base} />;
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
