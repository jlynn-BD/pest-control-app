import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../context/AuthContext";
import { ApiError } from "../../api/client";
import { InstallHint } from "../../components/InstallHint";
import { Field, PrimaryButton, colors } from "../../components/ui";

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState("tech@pestapp.dev");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [slow, setSlow] = useState(false);

  // The server sleeps when idle and can take a minute to wake; without a word
  // on screen it just looks like the button froze.
  useEffect(() => {
    if (!submitting) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(timer);
  }, [submitting]);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>PestApp Field</Text>
        <Text style={styles.subtitle}>Sign in to view your schedule and inspections</Text>

        <View style={styles.form}>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <PrimaryButton title="Log in" onPress={handleSubmit} loading={submitting} />
          {slow ? <Text style={styles.slow}>Waking up the server - the first sign-in can take up to a minute. Please keep this open.</Text> : null}
        </View>
        <InstallHint />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, justifyContent: "center", padding: 24 },
  title: { fontSize: 28, fontWeight: "700", color: colors.text, textAlign: "center" },
  subtitle: { fontSize: 14, color: colors.textMuted, textAlign: "center", marginTop: 6, marginBottom: 32 },
  form: {},
  error: { color: colors.danger, marginBottom: 14, textAlign: "center" },
  slow: { color: colors.textMuted, fontSize: 13, textAlign: "center", marginTop: 12 },
});
