import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBlock, Skeleton } from "../ui/blocks";
import { useFullBrightness } from "./brightness";
import type { CardResult } from "./card";
import { useCardDeps } from "./context";
import { MemberCardScreen } from "./MemberCardScreen";

type State = { readonly status: "loading" } | CardResult;

interface Navigator {
  navigate(name: string): void;
}

/** Loads the card, boosts the brightness while it is open and links to the other customer tabs. */
export function MemberCard() {
  const deps = useCardDeps();
  const navigation = useNavigation<Navigator>();
  const [state, setState] = useState<State>({ status: "loading" });
  const mounted = useRef(true);
  useFullBrightness(deps.brightness);

  const load = useCallback(async (): Promise<void> => {
    setState({ status: "loading" });
    const result = await deps.service.load();
    if (mounted.current) setState(result);
  }, [deps.service]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  if (state.status === "loading") return <Skeleton />;
  if (state.status === "failed") {
    return <ErrorBlock message={state.message} onRetry={() => void load()} />;
  }
  return (
    <MemberCardScreen
      cached={state.cached}
      offline={state.status === "offline"}
      onOpenAttendance={() => navigation.navigate("Visits")}
      onOpenProfile={() => navigation.navigate("Profile")}
    />
  );
}
