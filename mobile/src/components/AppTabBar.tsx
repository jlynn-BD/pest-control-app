import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts } from "./ui";

// The bottom bar: just two controls. A big orange "+" to start an inspection
// and Settings. (Past inspections are found by searching an address on the
// home screen; the customer list lives under Settings.)
export function AppTabBar({ state, navigation }: BottomTabBarProps) {
  const focused = state.routes[state.index]?.name;
  return (
    <View style={styles.bar}>
      <View style={styles.inner}>
      <Pressable
        style={styles.item}
        onPress={() => navigation.navigate("Inspections", { screen: "NewInspection" })}
        accessibilityRole="button"
        accessibilityLabel="New inspection"
      >
        <View style={styles.plus}>
          <Text style={styles.plusText}>+</Text>
        </View>
        <Text style={[styles.label, styles.labelPlus]}>New inspection</Text>
      </Pressable>
      <Pressable
        style={styles.item}
        onPress={() => navigation.navigate("Settings", { screen: "SettingsHome" })}
        accessibilityRole="button"
        accessibilityLabel="Settings"
      >
        <Text style={[styles.gear, focused === "Settings" && styles.gearActive]}>{"⚙"}</Text>
        <Text style={[styles.label, focused === "Settings" && styles.labelActive]}>Settings</Text>
      </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  inner: { flexDirection: "row", justifyContent: "space-around", alignItems: "center", width: "100%", maxWidth: 520 },
  bar: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 6,
    minHeight: 64,
    ...(Platform.OS === "web" ? { paddingBottom: "calc(env(safe-area-inset-bottom) + 6px)" as unknown as number } : { paddingBottom: 10 }),
  },
  item: { alignItems: "center", justifyContent: "center", minWidth: 120, minHeight: 52 },
  plus: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  plusText: { color: "#FFFFFF", fontSize: 28, lineHeight: 30, fontWeight: "600", fontFamily: fonts.body },
  gear: { fontSize: 28, lineHeight: 32, color: colors.textMuted },
  gearActive: { color: colors.primary },
  label: { fontSize: 11, marginTop: 2, fontFamily: fonts.body, fontWeight: "600", color: colors.textMuted },
  labelActive: { color: colors.primary },
  labelPlus: { color: colors.primaryText },
});
