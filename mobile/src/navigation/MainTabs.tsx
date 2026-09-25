import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import React from "react";
import { Platform, Text } from "react-native";
import CustomersNavigator from "./CustomersNavigator";
import InspectionsNavigator from "./InspectionsNavigator";
import ScheduleScreen from "../screens/schedule/ScheduleScreen";
import SettingsScreen from "../screens/settings/SettingsScreen";
import { colors } from "../components/ui";

const Tab = createBottomTabNavigator();

const ICONS: Record<string, string> = {
  Schedule: "\u{1F4C5}",
  Customers: "\u{1F465}",
  Inspections: "\u{1F50D}",
  Settings: "\u{2699}",
};

export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, paddingBottom: 2 },
        ...(Platform.OS === "web"
          ? { tabBarStyle: { minHeight: 62, paddingTop: 4, paddingBottom: "calc(env(safe-area-inset-bottom) + 6px)" as unknown as number } }
          : {}),
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.text,
        tabBarIcon: () => <Text style={{ fontSize: 20 }}>{ICONS[route.name]}</Text>,
      })}
    >
      <Tab.Screen name="Schedule" component={ScheduleScreen} />
      <Tab.Screen name="Customers" component={CustomersNavigator} options={{ headerShown: false }} />
      <Tab.Screen name="Inspections" component={InspectionsNavigator} options={{ headerShown: false }} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}
