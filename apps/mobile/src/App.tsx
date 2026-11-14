import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";
import { SIGNED_OUT } from "./auth/session";
import { ConfigError, type RuntimeConfig } from "./config/build-config";
import { ConfigProvider } from "./config/context";
import { type ConstantsLike, loadRuntimeConfig } from "./config/load";
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
      <StatusBar style="auto" />
      <RootNavigator session={SIGNED_OUT} />
    </ConfigProvider>
  );
}
