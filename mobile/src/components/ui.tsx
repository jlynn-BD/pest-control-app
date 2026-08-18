import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from "react-native";

export const colors = {
  bg: "#F4F6F5",
  card: "#FFFFFF",
  border: "#E1E6E3",
  text: "#1A2421",
  textMuted: "#5C6B65",
  primary: "#1F7A5C",
  primaryDark: "#155C44",
  danger: "#C0392B",
  warning: "#B8860B",
  chip: "#EAF3EF",
};

export function Screen({ children }: { children: React.ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function LoadingView({ label }: { label?: string }) {
  return (
    <View style={styles.centerFill}>
      <ActivityIndicator color={colors.primary} size="large" />
      {label ? <Text style={styles.mutedText}>{label}</Text> : null}
    </View>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.centerFill}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.mutedText}>{subtitle}</Text> : null}
    </View>
  );
}

export function ErrorView({ message }: { message: string }) {
  return (
    <View style={styles.centerFill}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function PrimaryButton({
  title,
  onPress,
  disabled,
  loading,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.primaryButton,
        (disabled || loading) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{title}</Text>}
    </Pressable>
  );
}

export function Field({
  label,
  ...inputProps
}: { label: string } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        placeholderTextColor={colors.textMuted}
        {...inputProps}
      />
    </View>
  );
}

export function Badge({ label, tone = "default" }: { label: string; tone?: "default" | "warning" | "danger" | "success" }) {
  const toneStyle =
    tone === "danger" ? styles.badgeDanger : tone === "warning" ? styles.badgeWarning : tone === "success" ? styles.badgeSuccess : styles.badgeDefault;
  return (
    <View style={[styles.badge, toneStyle]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  mutedText: { color: colors.textMuted, fontSize: 14, textAlign: "center" },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "600" },
  errorText: { color: colors.danger, fontSize: 14, textAlign: "center" },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { backgroundColor: colors.primaryDark },
  primaryButtonText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 13, color: colors.textMuted, marginBottom: 6, fontWeight: "500" },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
    backgroundColor: "#fff",
  },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeDefault: { backgroundColor: colors.chip },
  badgeWarning: { backgroundColor: "#FBF0D9" },
  badgeDanger: { backgroundColor: "#F8D7D3" },
  badgeSuccess: { backgroundColor: "#DBEFE4" },
  badgeText: { fontSize: 12, fontWeight: "600", color: colors.text },
});
