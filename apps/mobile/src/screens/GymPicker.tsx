import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, useGyms } from "../auth/context";
import type { GymChoice } from "../gyms";
import { ErrorBlock, Skeleton } from "../ui/blocks";
import { GymPickerScreen, NoGymScreen } from "./GymPickerScreen";

type View =
  | { readonly state: "loading" }
  | { readonly state: "none" }
  | { readonly state: "failed"; readonly message: string }
  | { readonly state: "list"; readonly gyms: readonly GymChoice[]; readonly error?: string };

/** One gym goes straight in, several show the picker, none shows the no gym screen. */
export function GymPicker() {
  const auth = useAuth();
  const gyms = useGyms();
  const [view, setView] = useState<View>({ state: "loading" });
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  const pick = useCallback(
    async (list: readonly GymChoice[], tenantId: string): Promise<void> => {
      setBusy(true);
      const result = await gyms.select(tenantId);
      // Entering a gym swaps this screen out, so only a failure needs to be shown.
      if (!mounted.current || result.status === "entered") return;
      setBusy(false);
      setView({ state: "list", gyms: list, error: result.message });
    },
    [gyms],
  );

  const load = useCallback(async (): Promise<void> => {
    setView({ state: "loading" });
    const result = await gyms.list();
    if (!mounted.current) return;
    if (result.status === "none") setView({ state: "none" });
    else if (result.status === "failed") setView({ state: "failed", message: result.message });
    else if (result.gyms.length === 1) {
      const [only] = result.gyms as [GymChoice];
      setView({ state: "list", gyms: result.gyms });
      await pick(result.gyms, only.tenantId);
    } else setView({ state: "list", gyms: result.gyms });
  }, [gyms, pick]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const switchAccount = () => void auth.signOut();

  switch (view.state) {
    case "loading":
      return <Skeleton />;
    case "failed":
      return <ErrorBlock message={view.message} onRetry={() => void load()} />;
    case "none":
      return <NoGymScreen onTryAgain={() => void load()} onUseAnotherAccount={switchAccount} />;
    case "list":
      return (
        <GymPickerScreen
          gyms={view.gyms}
          busy={busy}
          {...(view.error === undefined ? {} : { error: view.error })}
          onPick={(tenantId) => void pick(view.gyms, tenantId)}
          onUseAnotherAccount={switchAccount}
        />
      );
  }
}
