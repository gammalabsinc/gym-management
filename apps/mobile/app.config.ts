import type { ExpoConfig } from "expo/config";
import { appIdentity } from "./src/config/app-identity.ts";
import { parseBuildEnv } from "./src/config/build-config.ts";

// Every value comes from the build environment, never from source. A missing or
// malformed value stops the build here with an error that names the variable.
const runtime = parseBuildEnv(process.env);
const identity = appIdentity(runtime.profile);

const config: ExpoConfig = {
  name: identity.name,
  slug: "gym-management",
  version: "0.0.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: { bundleIdentifier: identity.appId },
  android: { package: identity.appId },
  extra: {
    profile: runtime.profile,
    apiUrl: runtime.apiUrl,
    googleIosClientId: runtime.googleClientIds?.ios,
    googleAndroidClientId: runtime.googleClientIds?.android,
  },
};

export default config;
