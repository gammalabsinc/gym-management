import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { type ReactNode, useMemo } from "react";
import { PlaceholderScreen } from "../screens/PlaceholderScreen";
import type { TabDefinition } from "./tabs";
import { confirmDiscard, createUnsavedGuard, tabNameOfKey, UnsavedGuardContext } from "./unsaved";

const Tab = createBottomTabNavigator();

/**
 * Tabs without a screen of their own yet show the placeholder. Leaving a tab that has unsaved
 * changes asks first, and stays put unless the person chooses to discard them.
 */
export function TabSet(props: {
  readonly tabs: readonly TabDefinition[];
  readonly screens?: Readonly<Record<string, () => ReactNode>>;
}) {
  const guard = useMemo(() => createUnsavedGuard(), []);
  return (
    <UnsavedGuardContext.Provider value={guard}>
      <Tab.Navigator
        screenListeners={({ navigation, route }) => ({
          tabPress: (event: { target?: string; preventDefault(): void }) => {
            if (!guard.isDirty() || event.target === undefined || event.target === route.key)
              return;
            event.preventDefault();
            const target = tabNameOfKey(event.target);
            void confirmDiscard().then((leave) => {
              if (!leave) return;
              guard.setDirty(false);
              navigation.navigate(target);
            });
          },
        })}
      >
        {props.tabs.map((tab) => (
          <Tab.Screen key={tab.name} name={tab.name} options={{ title: tab.title }}>
            {() => props.screens?.[tab.name]?.() ?? <PlaceholderScreen title={tab.title} />}
          </Tab.Screen>
        ))}
      </Tab.Navigator>
    </UnsavedGuardContext.Provider>
  );
}
