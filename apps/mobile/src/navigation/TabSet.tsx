import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import type { ReactNode } from "react";
import { PlaceholderScreen } from "../screens/PlaceholderScreen";
import type { TabDefinition } from "./tabs";

const Tab = createBottomTabNavigator();

/** Tabs without a screen of their own yet show the placeholder. */
export function TabSet(props: {
  readonly tabs: readonly TabDefinition[];
  readonly screens?: Readonly<Record<string, () => ReactNode>>;
}) {
  return (
    <Tab.Navigator>
      {props.tabs.map((tab) => (
        <Tab.Screen key={tab.name} name={tab.name} options={{ title: tab.title }}>
          {() => props.screens?.[tab.name]?.() ?? <PlaceholderScreen title={tab.title} />}
        </Tab.Screen>
      ))}
    </Tab.Navigator>
  );
}
