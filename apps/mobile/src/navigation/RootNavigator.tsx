import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { type Destination, destinationFor, type Session } from "../auth/session";
import { MemberCard } from "../card/MemberCard";
import { Customers } from "../customers/Customers";
import { Scanner } from "../scanner/Scanner";
import { GymPicker } from "../screens/GymPicker";
import { SignIn } from "../screens/SignIn";
import { Settings } from "../settings/Settings";
import { TabSet } from "./TabSet";
import { adminTabsFor, CUSTOMER_TABS } from "./tabs";

const CUSTOMER_SCREENS = { Card: () => <MemberCard /> };
const STAFF_SCREENS = {
  Scan: () => <Scanner />,
  Customers: () => <Customers />,
  Settings: () => <Settings viewer="staff" />,
};
const OWNER_SCREENS = { ...STAFF_SCREENS, Settings: () => <Settings viewer="owner" /> };

function Screen(props: { readonly destination: Destination; readonly session: Session }) {
  switch (props.destination) {
    case "signIn":
      return <SignIn />;
    case "picker":
      return <GymPicker />;
    case "customer":
      return <TabSet tabs={CUSTOMER_TABS} screens={CUSTOMER_SCREENS} />;
    case "admin": {
      const role = props.session.status === "signedIn" ? props.session.role : "staff";
      return (
        <TabSet
          screens={role === "owner" ? OWNER_SCREENS : STAFF_SCREENS}
          tabs={adminTabsFor(role)}
        />
      );
    }
  }
}

/** The auth gate: signed out users see sign in, members see the customer tabs, staff the admin tabs. */
export function RootNavigator(props: { readonly session: Session }) {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Screen destination={destinationFor(props.session)} session={props.session} />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
