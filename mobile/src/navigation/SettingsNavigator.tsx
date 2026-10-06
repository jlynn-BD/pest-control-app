import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import SettingsScreen from "../screens/settings/SettingsScreen";
import TeamScreen from "../screens/settings/TeamScreen";
import { colors } from "../components/ui";

const Stack = createNativeStackNavigator();

export default function SettingsNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.card }, headerTintColor: colors.text }}>
      <Stack.Screen name="SettingsHome" component={SettingsScreen} options={{ title: "Settings" }} />
      <Stack.Screen name="Team" component={TeamScreen} options={{ title: "Team" }} />
    </Stack.Navigator>
  );
}
