import { createContext, type ReactNode, useContext } from "react";
import type { ProfileService } from "./service";

const ProfileContext = createContext<ProfileService | null>(null);

export function ProfileProvider(props: {
  readonly service: ProfileService;
  readonly children?: ReactNode;
}) {
  return <ProfileContext.Provider value={props.service}>{props.children}</ProfileContext.Provider>;
}

export function useProfileService(): ProfileService {
  const service = useContext(ProfileContext);
  if (service === null) throw new Error("useProfileService needs a ProfileProvider above it");
  return service;
}
