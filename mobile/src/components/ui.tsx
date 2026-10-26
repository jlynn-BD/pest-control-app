import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from "react-native";

// Blue Duck Pest Control brand colors (from the brand guidelines):
//   navy 002255 - deep blue 003969 - blue 0079FF - sky 26A5FF - light sky 4DD2FF
//   teal green 007A66 - lime 77C242 - orange E67300 - yellow FFC20D - pale yellow FFF3A3
// The greys are tints of the navy so everything sits in one family.
export const colors = {
  bg: "#F3F7FC",
  card: "#FFFFFF",
  border: "#D9E3F0",
  text: "#002255", // navy
  textMuted: "#51668A",
  primary: "#0079FF", // bright blue: buttons, selected states, active tabs
  primaryDark: "#003969", // deep blue: pressed buttons, headers
  primaryText: "#0062CC", // the same blue, darkened a touch so small link text stays easy to read
  success: "#007A66", // teal green: OK / done / completed
  danger: "#C0392B",
  warning: "#E67300", // orange
  chip: "#E6F1FF",
  navy: "#002255",
  sky: "#26A5FF",
  lime: "#77C242",
  orange: "#E67300",
  yellow: "#FFC20D",
  paleYellow: "#FFF3A3",
};

// Brand typefaces. The brand fonts Country Blues / Ronsard Crystal are paid, so
// the guidelines' free alternates are used: Barlow for display headings, Krona
// One for the big headline, Red Hat Text for everything else. Loaded by the web
// app (see public/fonts); other platforms fall back to the system font.
export const fonts = {
  body: Platform.OS === "web" ? "'Red Hat Text', system-ui, -apple-system, sans-serif" : undefined,
  display: Platform.OS === "web" ? "Barlow, 'Red Hat Text', system-ui, sans-serif" : undefined,
  headline: Platform.OS === "web" ? "'Krona One', Barlow, system-ui, sans-serif" : undefined,
};

// Header bar for the stacks: navy with white title, like the brand's buttons and logo badge.
export const headerScreenOptions = {
  headerStyle: { backgroundColor: colors.navy },
  headerTintColor: "#FFFFFF",
  headerTitleStyle: { fontFamily: fonts.display, fontWeight: "700" as const, fontSize: 20 },
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

// "cta" is the bright orange call-to-action (sign in, complete, share); the
// brand guide asks for brighter colors on those. "navy" is the brand's dark button.
export type ButtonVariant = "primary" | "cta" | "navy" | "success";
const BUTTON_COLOR: Record<ButtonVariant, { bg: string; pressed: string }> = {
  primary: { bg: colors.primary, pressed: colors.primaryDark },
  cta: { bg: colors.orange, pressed: "#BF5E00" },
  navy: { bg: colors.navy, pressed: "#001A40" },
  success: { bg: colors.success, pressed: "#005C4D" },
};

export function PrimaryButton({
  title,
  onPress,
  disabled,
  loading,
  variant = "primary",
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: ButtonVariant;
}) {
  const color = BUTTON_COLOR[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: pressed ? color.pressed : color.bg },
        (disabled || loading) && styles.buttonDisabled,
      ]}
    >
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>{title}</Text>}
    </Pressable>
  );
}

export function Field({
  label,
  secureTextEntry,
  inputRef,
  ...inputProps
}: { label: string; inputRef?: React.Ref<TextInput> } & TextInputProps) {
  // Password fields get a Show/Hide toggle so a person can check what they
  // typed (easy to fumble on a phone keyboard).
  const [revealed, setRevealed] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View>
        <TextInput
          ref={inputRef}
          style={[styles.input, secureTextEntry && styles.inputWithToggle]}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={secureTextEntry && !revealed}
          {...inputProps}
        />
        {secureTextEntry ? (
          <Pressable
            onPress={() => setRevealed((r) => !r)}
            style={styles.revealButton}
            accessibilityRole="button"
            accessibilityLabel={revealed ? "Hide password" : "Show password"}
            hitSlop={8}
          >
            <Text style={styles.revealText}>{revealed ? "Hide" : "Show"}</Text>
          </Pressable>
        ) : null}
      </View>
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

export function Checkbox({
  label,
  checked,
  onChange,
  required,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  required?: boolean;
}) {
  return (
    <Pressable
      style={styles.checkboxRow}
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <View style={[styles.checkboxBox, checked && styles.checkboxBoxChecked]}>
        {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
      </View>
      <Text style={styles.checkboxLabel}>
        {label}
        {required ? " *" : ""}
      </Text>
    </Pressable>
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
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: "700", fontFamily: fonts.display },
  errorText: { color: colors.danger, fontSize: 14, textAlign: "center" },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: { opacity: 0.5 },
  primaryButtonText: { color: "#fff", fontWeight: "700", fontSize: 16, fontFamily: fonts.body },
  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 13, color: colors.textMuted, marginBottom: 6, fontWeight: "500" },
  inputWithToggle: { paddingRight: 64 },
  revealButton: { position: "absolute", right: 0, top: 0, bottom: 0, paddingHorizontal: 14, justifyContent: "center" },
  revealText: { color: colors.primary, fontSize: 14, fontWeight: "600" },
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
  badgeWarning: { backgroundColor: colors.paleYellow },
  badgeDanger: { backgroundColor: "#F8D7D3" },
  badgeSuccess: { backgroundColor: "#D3EFE9" },
  badgeText: { fontSize: 12, fontWeight: "600", color: colors.text },
  checkboxRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  checkboxBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  checkboxBoxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxMark: { color: "#fff", fontSize: 15, fontWeight: "700", lineHeight: 16 },
  checkboxLabel: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.text },
});
