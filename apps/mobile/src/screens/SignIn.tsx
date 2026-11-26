import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/context";
import { SignInScreen, type SignInView } from "./SignInScreen";

/** Runs Google sign in. A cancel returns to the start with no message. A failure shows one fixed message. */
export function SignIn() {
  const auth = useAuth();
  const [view, setView] = useState<SignInView>({ state: "default" });
  const mounted = useRef(true);
  const busy = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function onContinue(): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setView({ state: "signingIn" });
    const result = await auth.signIn();
    busy.current = false;
    // A successful sign in swaps this screen out, so there is nothing left to update.
    if (!mounted.current || result.status === "signedIn") return;
    setView(
      result.status === "cancelled"
        ? { state: "default" }
        : { state: "error", message: result.message },
    );
  }

  return <SignInScreen view={view} onContinue={() => void onContinue()} />;
}
