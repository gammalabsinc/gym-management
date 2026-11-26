import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { type Destination, destinationFor, type Session } from "../auth/session";
import { PlaceholderScreen } from "../screens/PlaceholderScreen";
import { SignIn } from "../screens/SignIn";
import { TabSet } from "./TabSet";
import { ADMIN_TABS, CUSTOMER_TABS } from "./tabs";

function Screen(props: { readonly destination: Destination }) {
  switch (props.destination) {
    case "signIn":
      return <SignIn />;
    case "picker":
      return <PlaceholderScreen title="Pick a gym" />;
    case "customer":
      return <TabSet tabs={CUSTOMER_TABS} />;
    case "admin":
      return <TabSet tabs={ADMIN_TABS} />;
  }
}

/** The auth gate: signed out users see sign in, members see the customer tabs, staff the admin tabs. */
export function RootNavigator(props: { readonly session: Session }) {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Screen destination={destinationFor(props.session)} />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
