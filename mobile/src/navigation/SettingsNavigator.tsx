import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import SettingsScreen from "../screens/settings/SettingsScreen";
import TeamScreen from "../screens/settings/TeamScreen";
import ActivityLogScreen from "../screens/settings/ActivityLogScreen";
import { headerScreenOptions } from "../components/ui";

const Stack = createNativeStackNavigator();

export default function SettingsNavigator() {
  return (
    <Stack.Navigator screenOptions={headerScreenOptions}>
      <Stack.Screen name="SettingsHome" component={SettingsScreen} options={{ title: "Settings" }} />
      <Stack.Screen name="Team" component={TeamScreen} options={{ title: "Team" }} />
      <Stack.Screen name="ActivityLog" component={ActivityLogScreen as React.ComponentType} options={{ title: "Activity log" }} />
    </Stack.Navigator>
  );
}
