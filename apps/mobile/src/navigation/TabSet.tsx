import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { PlaceholderScreen } from "../screens/PlaceholderScreen";
import type { TabDefinition } from "./tabs";

const Tab = createBottomTabNavigator();

export function TabSet(props: { readonly tabs: readonly TabDefinition[] }) {
  return (
    <Tab.Navigator>
      {props.tabs.map((tab) => (
        <Tab.Screen key={tab.name} name={tab.name} options={{ title: tab.title }}>
          {() => <PlaceholderScreen title={tab.title} />}
        </Tab.Screen>
      ))}
    </Tab.Navigator>
  );
}
