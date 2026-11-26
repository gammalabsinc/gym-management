import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { ClientProvider } from "./api/hooks";
import { AttendanceProvider } from "./attendance/context";
import { AuthProvider, GymsProvider } from "./auth/context";
import { CardProvider } from "./card/context";
import { ConfigError, type RuntimeConfig } from "./config/build-config";
import { ConfigProvider } from "./config/context";
import { type ConstantsLike, loadRuntimeConfig } from "./config/load";
import { ProfileMarker } from "./config/ProfileMarker";
import { CustomersProvider } from "./customers/context";
import { DetailProvider } from "./customers/detail/context";
import { RootNavigator } from "./navigation/RootNavigator";
import { ProfileProvider } from "./profile/context";
import { ScannerProvider } from "./scanner/context";
import { composeServices, type Platform } from "./services";
import { SettingsProvider } from "./settings/context";
import { StaffProvider } from "./staff/context";

export interface AppProps {
  readonly constants: ConstantsLike;
  readonly platform: Platform;
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

function Authenticated(props: { readonly config: RuntimeConfig; readonly platform: Platform }) {
  const { config, platform } = props;
  const services = useMemo(
    () => composeServices(config, platform, (input, init) => fetch(input, init)),
    [config, platform],
  );
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    let current = true;
    services.auth.restore().then(() => {
      if (current) setRestored(true);
    });
    return () => {
      current = false;
    };
  }, [services]);
  const session = useSyncExternalStore(services.store.subscribe, services.store.getSession);
  return (
    <ClientProvider client={services.client}>
      <AuthProvider auth={services.auth}>
        <StatusBar style="auto" />
        <ProfileMarker profile={config.profile} />
        <GymsProvider gyms={services.gyms}>
          <CardProvider deps={services.card}>
            <ScannerProvider deps={services.scanner}>
              <CustomersProvider service={services.customers}>
                <SettingsProvider service={services.settings}>
                  <StaffProvider service={services.staff}>
                    <AttendanceProvider service={services.attendance}>
                      <ProfileProvider service={services.profile}>
                        <DetailProvider service={services.detail}>
                          {restored ? <RootNavigator session={session} /> : null}
                        </DetailProvider>
                      </ProfileProvider>
                    </AttendanceProvider>
                  </StaffProvider>
                </SettingsProvider>
              </CustomersProvider>
            </ScannerProvider>
          </CardProvider>
        </GymsProvider>
      </AuthProvider>
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
      <Authenticated config={result.config} platform={props.platform} />
    </ConfigProvider>
  );
}
