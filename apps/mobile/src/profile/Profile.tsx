import { useCallback, useEffect, useRef, useState } from "react";
import { Linking } from "react-native";
import { useAuth } from "../auth/context";
import { ErrorBlock, Skeleton } from "../ui/blocks";
import { useProfileService } from "./context";
import { mailUrl, telUrl } from "./links";
import { ProfileScreen } from "./ProfileScreen";
import type { ProfileResult, ProfileService } from "./service";

type State = { readonly status: "loading" } | ProfileResult;

/** Opens a phone or mail link. A device without a dialer or mail app just does nothing. */
function open(url: string): void {
  Linking.openURL(url).catch(() => undefined);
}

export function Profile() {
  const service: ProfileService = useProfileService();
  const auth = useAuth();
  const [state, setState] = useState<State>({ status: "loading" });
  const [signOutError, setSignOutError] = useState(false);
  const mounted = useRef(true);

  const load = useCallback(async (): Promise<void> => {
    setState({ status: "loading" });
    const result = await service.load();
    if (mounted.current) setState(result);
  }, [service]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const signOut = async (): Promise<void> => {
    const result = await auth.signOut();
    if (mounted.current) setSignOutError(!result.cleared);
  };

  if (state.status === "loading") return <Skeleton />;
  if (state.status === "failed") {
    return <ErrorBlock message={state.message} onRetry={() => void load()} />;
  }
  return (
    <ProfileScreen
      profile={state.profile}
      signOutError={signOutError}
      onCall={(phone) => open(telUrl(phone))}
      onEmail={(email) => open(mailUrl(email))}
      onSignOut={() => void signOut()}
    />
  );
}
