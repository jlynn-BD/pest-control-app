import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import React from "react";
import CustomersNavigator from "./CustomersNavigator";
import InspectionsNavigator from "./InspectionsNavigator";
import SettingsNavigator from "./SettingsNavigator";
import { AppTabBar } from "../components/AppTabBar";

const Tab = createBottomTabNavigator();

// The bottom bar shows only "+" (new inspection) and Settings (see AppTabBar).
// "Inspections" is the home area; "Customers" is still a screen here - it is
// reached from Settings, and from "add a new customer/property" - it just has
// no button of its own any more.
export default function MainTabs() {
  return (
    <Tab.Navigator initialRouteName="Inspections" tabBar={(props) => <AppTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Inspections" component={InspectionsNavigator} />
      <Tab.Screen name="Customers" component={CustomersNavigator} />
      <Tab.Screen name="Settings" component={SettingsNavigator} />
    </Tab.Navigator>
  );
}
