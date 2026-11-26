import { createContext, type ReactNode, useContext } from "react";
import type { Auth } from "./auth";

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider(props: { readonly auth: Auth; readonly children?: ReactNode }) {
  return <AuthContext.Provider value={props.auth}>{props.children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (auth === null) throw new Error("useAuth needs an AuthProvider above it");
  return auth;
}
