import { StatusBar } from "expo-status-bar";
import { useMemo, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { createClient } from "./api/client";
import { ClientProvider } from "./api/hooks";
import { createSessionStore, type SessionStore } from "./auth/session-store";
import { ConfigError, type RuntimeConfig } from "./config/build-config";
import { ConfigProvider } from "./config/context";
import { type ConstantsLike, loadRuntimeConfig } from "./config/load";
import { ProfileMarker } from "./config/ProfileMarker";
import { RootNavigator } from "./navigation/RootNavigator";

export interface AppProps {
  readonly constants: ConstantsLike;
}

type ConfigResult =
  | { readonly ok: true; readonly config: RuntimeConfig }
  | { readonly ok: false; readonly message: string };

function readConfig(constants: ConstantsLike): ConfigResult {
  try {
    return { ok: true, config: loadRuntimeConfig(constants) };
  } catch (error) {
    if (error instanceof ConfigError) return { ok: false, message: error.message };
    throw error;
  }
}

function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function Authenticated(props: { readonly config: RuntimeConfig }) {
  const store: SessionStore = useMemo(() => createSessionStore(), []);
  const client = useMemo(
    () =>
      createClient({
        apiUrl: props.config.apiUrl,
        getToken: store.getToken,
        onUnauthenticated: store.signOut,
        newRequestId,
        fetch: (input, init) => fetch(input, init),
      }),
    [props.config.apiUrl, store],
  );
  const session = useSyncExternalStore(store.subscribe, store.getSession);
  return (
    <ClientProvider client={client}>
      <StatusBar style="auto" />
      <ProfileMarker profile={props.config.profile} />
      <RootNavigator session={session} />
    </ClientProvider>
  );
}

export function App(props: AppProps) {
  const result = readConfig(props.constants);
  if (!result.ok) {
    return (
      <View>
        <Text>{result.message}</Text>
      </View>
    );
  }
  return (
    <ConfigProvider config={result.config}>
      <Authenticated config={result.config} />
    </ConfigProvider>
  );
}
