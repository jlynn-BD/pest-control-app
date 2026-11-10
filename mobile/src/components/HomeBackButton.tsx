import { useNavigation } from "@react-navigation/native";
import React from "react";
import { Pressable, Text } from "react-native";
import { fonts } from "./ui";

// "‹ Home" for the top-left of screens that sit outside the inspection flow
// (Settings, Customers), now that the bottom bar only has + and Settings.
export function HomeBackButton() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const navigation = useNavigation<any>();
  return (
    <Pressable
      onPress={() => navigation.navigate("Inspections", { screen: "Home" })}
      accessibilityRole="button"
      accessibilityLabel="Back to the home screen"
      hitSlop={10}
      style={{ paddingHorizontal: 8, paddingVertical: 4 }}
    >
      <Text style={{ color: "#FFFFFF", fontSize: 17, fontFamily: fonts.body, fontWeight: "600" }}>‹ Home</Text>
    </Pressable>
  );
}
