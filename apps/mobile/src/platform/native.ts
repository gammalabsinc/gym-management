import { GoogleSignin } from "@react-native-google-signin/google-signin";
import * as SecureStore from "expo-secure-store";
import type { Platform } from "../services";

/** The real native libraries. Only the entry point imports this file. */
export const nativePlatform: Platform = {
  secureStore: SecureStore,
  accessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  google: GoogleSignin,
};
