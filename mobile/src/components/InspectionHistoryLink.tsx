import { useNavigation } from "@react-navigation/native";
import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useAuth } from "../context/AuthContext";
import { colors } from "./ui";

// Admins and office staff get a one-tap way from an inspection to everything
// that was done to it (who, what, when). Technicians don't see it.
export function InspectionHistoryLink({ inspectionId, title }: { inspectionId: string; title?: string }) {
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  if (user?.role !== "ADMIN" && user?.role !== "OFFICE") return null;
  return (
    <Pressable
      onPress={() => navigation.navigate("Settings", { screen: "ActivityLog", params: { inspectionId, title } })}
      accessibilityRole="link"
      style={styles.link}
    >
      <Text style={styles.text}>🕘 View history: who did what on this inspection</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { paddingVertical: 8 },
  text: { color: colors.primary, fontWeight: "600", fontSize: 14 },
});
