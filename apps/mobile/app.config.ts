import type { ExpoConfig } from "expo/config";
import { parseBuildEnv } from "./src/config/build-config.ts";

// The API URL and environment come from the build environment, never from source.
const runtime = parseBuildEnv(process.env);

const config: ExpoConfig = {
  name: "Gym",
  slug: "gym-management",
  version: "0.0.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  extra: { appEnv: runtime.appEnv, apiUrl: runtime.apiUrl },
};

export default config;
