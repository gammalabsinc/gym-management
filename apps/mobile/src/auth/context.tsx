import { createContext, type ReactNode, useContext } from "react";
import type { Gyms } from "../gyms";
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

const GymsContext = createContext<Gyms | null>(null);

export function GymsProvider(props: { readonly gyms: Gyms; readonly children?: ReactNode }) {
  return <GymsContext.Provider value={props.gyms}>{props.children}</GymsContext.Provider>;
}

export function useGyms(): Gyms {
  const gyms = useContext(GymsContext);
  if (gyms === null) throw new Error("useGyms needs a GymsProvider above it");
  return gyms;
}
