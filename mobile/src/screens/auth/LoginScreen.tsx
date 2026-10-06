import React, { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "../../context/AuthContext";
import { ApiError } from "../../api/client";
import type { Challenge, LoginResult, SignedIn } from "../../api/auth";
import { InstallHint } from "../../components/InstallHint";
import { Field, PrimaryButton, colors } from "../../components/ui";
import { EnrollStep, PasswordChangeStep, RecoveryCodesStep, VerifyStep } from "./AuthSteps";

export default function LoginScreen() {
  const { login, completeSignIn } = useAuth();
  // Deliberately empty: every person signs in with their own account. (The
  // old screen pre-filled a shared demo login.)
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [slow, setSlow] = useState(false);
  // What the server asked for after the password. null = still on the first form.
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  // Set after two-step setup: the finished sign-in is held back until the
  // person has seen their one-time recovery codes.
  const [pendingSignIn, setPendingSignIn] = useState<SignedIn | null>(null);

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

  function startOver() {
    setChallenge(null);
    setPendingSignIn(null);
    setPassword("");
    setError(null);
  }

  function handleResult(res: LoginResult) {
    if (res.status === "challenge") setChallenge(res);
    // "ok" with no code needed is handled inside login() itself.
  }

  async function handleSignedIn(res: SignedIn) {
    if (res.recoveryCodes?.length) setPendingSignIn(res);
    else await completeSignIn(res);
  }

  // Browsers and password managers can fill these boxes without telling the
  // app (so the state stays empty). Read what's actually in the boxes at the
  // moment of tapping, and never gray the button out on stale state.
  function currentValue(state: string, ref: React.RefObject<TextInput | null>): string {
    if (state) return state;
    const el = ref.current as unknown as { value?: string } | null;
    return typeof el?.value === "string" ? el.value : "";
  }

  async function handleSubmit() {
    const typedEmail = currentValue(email, emailRef).trim();
    const typedPassword = currentValue(password, passwordRef);
    if (!typedEmail || !typedPassword) {
      setError("Enter your email and password.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      handleResult(await login(typedEmail, typedPassword));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  let body: React.ReactNode;
  if (pendingSignIn) {
    body = <RecoveryCodesStep codes={pendingSignIn.recoveryCodes ?? []} onDone={() => completeSignIn(pendingSignIn)} />;
  } else if (challenge?.next === "password_change") {
    body = <PasswordChangeStep challenge={challenge} onResult={handleResult} onCancel={startOver} />;
  } else if (challenge?.next === "mfa_enroll") {
    body = <EnrollStep challenge={challenge} onSignedIn={handleSignedIn} onCancel={startOver} />;
  } else if (challenge?.next === "mfa_verify") {
    body = <VerifyStep challenge={challenge} onSignedIn={handleSignedIn} onCancel={startOver} />;
  } else {
    body = (
      <>
        <Text style={styles.subtitle}>Sign in to view your schedule and inspections</Text>
        <View style={styles.form}>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            inputRef={emailRef}
            keyboardType="email-address"
            autoComplete="username"
            textContentType="username"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            inputRef={passwordRef}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={handleSubmit}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <PrimaryButton title="Log in" onPress={handleSubmit} loading={submitting} />
          {slow ? <Text style={styles.slow}>Waking up the server - the first sign-in can take up to a minute. Please keep this open.</Text> : null}
        </View>
      </>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>PestApp Field</Text>
        {body}
        <InstallHint />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, justifyContent: "center", padding: 24 },
  title: { fontSize: 28, fontWeight: "700", color: colors.text, textAlign: "center", marginBottom: 6 },
  subtitle: { fontSize: 14, color: colors.textMuted, textAlign: "center", marginBottom: 32 },
  form: {},
  error: { color: colors.danger, marginBottom: 14, textAlign: "center" },
  slow: { color: colors.textMuted, fontSize: 13, textAlign: "center", marginTop: 12 },
});
