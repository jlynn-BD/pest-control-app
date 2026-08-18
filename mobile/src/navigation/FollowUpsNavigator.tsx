import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import FollowUpDetailScreen from "../screens/followups/FollowUpDetailScreen";
import FollowUpListScreen from "../screens/followups/FollowUpListScreen";
import { FollowUpsStackParamList } from "./navigationTypes";
import { colors } from "../components/ui";

const Stack = createNativeStackNavigator<FollowUpsStackParamList>();

export default function FollowUpsNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.card }, headerTintColor: colors.text }}>
      <Stack.Screen name="FollowUpList" component={FollowUpListScreen} options={{ title: "Follow-ups" }} />
      <Stack.Screen name="FollowUpDetail" component={FollowUpDetailScreen} options={{ title: "Follow-up" }} />
    </Stack.Navigator>
  );
}
