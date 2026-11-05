import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import React from "react";
import { Platform, Text } from "react-native";
import CustomersNavigator from "./CustomersNavigator";
import InspectionsNavigator from "./InspectionsNavigator";
import SettingsNavigator from "./SettingsNavigator";
import { colors, fonts, headerScreenOptions } from "../components/ui";

const Tab = createBottomTabNavigator();

const ICONS: Record<string, string> = {
  Customers: "\u{1F465}",
  Inspections: "\u{1F50D}",
  Settings: "\u{2699}",
};

export default function MainTabs() {
  return (
    <Tab.Navigator
      initialRouteName="Inspections"
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, paddingBottom: 2, fontFamily: fonts.body, fontWeight: "600" },
        ...(Platform.OS === "web"
          ? { tabBarStyle: { minHeight: 62, paddingTop: 4, paddingBottom: "calc(env(safe-area-inset-bottom) + 6px)" as unknown as number } }
          : {}),
        ...headerScreenOptions,
        tabBarIcon: () => <Text style={{ fontSize: 20 }}>{ICONS[route.name]}</Text>,
      })}
    >
      <Tab.Screen name="Customers" component={CustomersNavigator} options={{ headerShown: false }} />
      <Tab.Screen name="Inspections" component={InspectionsNavigator} options={{ headerShown: false }} />
      <Tab.Screen name="Settings" component={SettingsNavigator} options={{ headerShown: false }} />
    </Tab.Navigator>
  );
}
