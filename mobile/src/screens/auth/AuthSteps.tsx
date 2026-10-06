import React, { useEffect, useRef, useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as authApi from "../../api/auth";
import { ApiError } from "../../api/client";
import { Field, PrimaryButton, colors } from "../../components/ui";

// The steps that can follow a correct password. Each one reports what the
// server answered through onResult; the sign-in screen decides what to show
// next. Errors stay on the step so the person can retry.

function messageFor(err: unknown): string {
  return err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

// Browsers/password managers/SMS autofill can fill a box without telling the
// app, leaving the state empty. Read what's really in the box when tapped.
function readValue(state: string, ref: React.RefObject<TextInput | null>): string {
  if (state) return state;
  const el = ref.current as unknown as { value?: string } | null;
  return typeof el?.value === "string" ? el.value : "";
}

function StepError({ message }: { message: string | null }) {
  return message ? <Text style={styles.error}>{message}</Text> : null;
}

function LinkButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={styles.link}>
      <Text style={[styles.linkText, disabled && styles.linkDisabled]}>{title}</Text>
    </Pressable>
  );
}

// ---- a temporary password must be replaced --------------------------------

export function PasswordChangeStep({ challenge, onResult, onCancel }: { challenge: authApi.Challenge; onResult: (r: authApi.LoginResult) => void; onCancel: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const newPassword = readValue(password, passwordRef);
    const again = readValue(confirm, confirmRef);
    if (!newPassword) {
      setError("Enter a new password.");
      return;
    }
    if (newPassword !== again) {
      setError("The two passwords don't match.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      onResult(await authApi.changeRequiredPassword(challenge.challengeToken, newPassword));
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Text style={styles.heading}>Choose your own password</Text>
      <Text style={styles.body}>You signed in with a temporary password. Pick a new one that only you know - at least 10 characters.</Text>
      <Field label="New password" inputRef={passwordRef} value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      <Field label="Confirm new password" inputRef={confirmRef} value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      <StepError message={error} />
      <PrimaryButton title="Save password" onPress={submit} loading={busy} />
      <LinkButton title="Cancel" onPress={onCancel} />
    </View>
  );
}

// ---- first-time two-step setup -----------------------------------------------

export function EnrollStep({ challenge, onSignedIn, onCancel }: { challenge: authApi.Challenge; onSignedIn: (r: authApi.SignedIn) => void; onCancel: () => void }) {
  const [method, setMethod] = useState<authApi.MfaMethod | null>(null);
  const [totp, setTotp] = useState<authApi.TotpEnrollment | null>(null);
  const [phone, setPhone] = useState("");
  const [smsSentTo, setSmsSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const codeRef = useRef<TextInput>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function chooseAuthenticator() {
    setError(null);
    setBusy(true);
    try {
      setTotp(await authApi.startEnrollment(challenge.challengeToken, "TOTP"));
      setMethod("TOTP");
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendText() {
    if (phone.replace(/\D/g, "").length < 10) {
      setError("Enter your 10-digit mobile number.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await authApi.startEnrollment(challenge.challengeToken, "SMS", phone);
      setSmsSentTo(res.maskedPhone);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    const typed = readValue(code, codeRef);
    if (typed.replace(/\s/g, "").length !== 6) {
      setError("Enter the 6-digit code.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      onSignedIn(await authApi.confirmEnrollment(challenge.challengeToken, typed));
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  const codeField = (
    <Field
      label="6-digit code"
      inputRef={codeRef}
      value={code}
      onChangeText={(t) => setCode(t.replace(/[^0-9 ]/g, ""))}
      keyboardType="number-pad"
      inputMode="numeric"
      maxLength={7}
      autoComplete="one-time-code"
      textContentType="oneTimeCode"
    />
  );

  if (!method) {
    return (
      <View>
        <Text style={styles.heading}>Set up two-step sign-in</Text>
        <Text style={styles.body}>
          To protect customer information, every sign-in needs a second step: a code from your phone. Choose how you want to get it.
        </Text>
        <StepError message={error} />
        <PrimaryButton title="Use an authenticator app" onPress={chooseAuthenticator} loading={busy} />
        <Text style={styles.hint}>Recommended. Works with no signal. Google Authenticator, Microsoft Authenticator, Authy, 1Password and similar apps.</Text>
        {challenge.smsAvailable ? (
          <>
            <View style={styles.gap} />
            <PrimaryButton title="Text me a code" onPress={() => setMethod("SMS")} disabled={busy} />
            <Text style={styles.hint}>We text a 6-digit code to your mobile number each time you sign in. Needs cell signal.</Text>
          </>
        ) : (
          <Text style={styles.hint}>Text-message codes aren't switched on yet.</Text>
        )}
        <LinkButton title="Cancel" onPress={onCancel} />
      </View>
    );
  }

  if (method === "TOTP" && totp) {
    return (
      <View>
        <Text style={styles.heading}>Add this account to your authenticator app</Text>
        <Text style={styles.body}>1. Open your authenticator app and add an account.{"\n"}2. Scan this picture, or enter the key by hand.{"\n"}3. Type the 6-digit code it shows.</Text>
        <View style={styles.qrWrap}>
          <Image source={{ uri: totp.qrDataUrl }} style={styles.qr} accessibilityLabel="QR code for your authenticator app" />
        </View>
        <Text style={styles.hint}>Can't scan? Enter this key:</Text>
        <Text selectable style={styles.secret}>
          {totp.secret}
        </Text>
        <LinkButton title="On this phone? Open my authenticator app" onPress={() => Linking.openURL(totp.otpauthUrl).catch(() => setError("No authenticator app opened. Enter the key by hand instead."))} />
        {codeField}
        <StepError message={error} />
        <PrimaryButton title="Confirm" onPress={confirm} loading={busy} />
        <LinkButton title="Choose a different method" onPress={() => { setMethod(null); setTotp(null); setCode(""); setError(null); }} />
      </View>
    );
  }

  // SMS
  return (
    <View>
      <Text style={styles.heading}>Text-message codes</Text>
      {smsSentTo ? (
        <>
          <Text style={styles.body}>We texted a code to {smsSentTo}. Enter it below.</Text>
          {codeField}
          <StepError message={error} />
          <PrimaryButton title="Confirm" onPress={confirm} loading={busy} />
          <LinkButton
            title="Send the text again"
            disabled={busy}
            onPress={async () => {
              setError(null);
              try {
                await authApi.resendMfaCode(challenge.challengeToken);
              } catch (err) {
                setError(messageFor(err));
              }
            }}
          />
        </>
      ) : (
        <>
          <Text style={styles.body}>Enter the mobile number that should receive your sign-in codes. Standard message rates may apply.</Text>
          <Field label="Mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="555-123-4567" />
          <StepError message={error} />
          <PrimaryButton title="Send code" onPress={sendText} loading={busy} />
        </>
      )}
      <LinkButton title="Choose a different method" onPress={() => { setMethod(null); setSmsSentTo(null); setCode(""); setError(null); }} />
    </View>
  );
}

// ---- the code, on every sign-in ----------------------------------------------

export function VerifyStep({ challenge, onSignedIn, onCancel }: { challenge: authApi.Challenge; onSignedIn: (r: authApi.SignedIn) => void; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const verifyRef = useRef<TextInput>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(30);
  const [useRecovery, setUseRecovery] = useState(false);
  const sms = challenge.method === "SMS";

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function submit() {
    const typed = readValue(code, verifyRef).trim();
    if (!typed) {
      setError(useRecovery ? "Enter a recovery code." : "Enter the 6-digit code.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      onSignedIn(await authApi.verifyMfa(challenge.challengeToken, typed));
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setInfo(null);
    try {
      await authApi.resendMfaCode(challenge.challengeToken);
      setInfo("We sent a new code.");
      setCooldown(30);
    } catch (err) {
      setError(messageFor(err));
    }
  }

  return (
    <View>
      <Text style={styles.heading}>Enter your code</Text>
      <Text style={styles.body}>
        {useRecovery
          ? "Type one of the recovery codes you saved when you set up two-step sign-in. Each one works once."
          : sms
            ? `We texted a 6-digit code to ${challenge.maskedPhone ?? "your phone"}.`
            : "Open your authenticator app and type the 6-digit code for PestApp."}
      </Text>
      {useRecovery ? (
        <Field label="Recovery code" inputRef={verifyRef} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} placeholder="XXXXX-XXXXX" />
      ) : (
        <Field
          label="6-digit code"
          inputRef={verifyRef}
          value={code}
          onChangeText={(t) => setCode(t.replace(/[^0-9 ]/g, ""))}
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={7}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          autoFocus
          onSubmitEditing={submit}
        />
      )}
      {info ? <Text style={styles.info}>{info}</Text> : null}
      <StepError message={error} />
      <PrimaryButton title="Sign in" onPress={submit} loading={busy} />
      {sms && !useRecovery ? <LinkButton title={cooldown > 0 ? `Send a new code (${cooldown}s)` : "Send a new code"} onPress={resend} disabled={cooldown > 0} /> : null}
      <LinkButton title={useRecovery ? "Use my authenticator/text code instead" : "Lost your phone? Use a recovery code"} onPress={() => { setUseRecovery(!useRecovery); setCode(""); setError(null); }} />
      <LinkButton title="Back to sign in" onPress={onCancel} />
    </View>
  );
}

// ---- recovery codes, shown once -----------------------------------------------

export function RecoveryCodesStep({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <View>
      <Text style={styles.heading}>Save your recovery codes</Text>
      <Text style={styles.body}>
        If you lose your phone, each of these codes lets you sign in once. Write them down or save them somewhere private, away from your phone. They won't be shown again.
      </Text>
      <View style={styles.codeBox}>
        {codes.map((c) => (
          <Text key={c} selectable style={styles.recoveryCode}>
            {c}
          </Text>
        ))}
      </View>
      <Pressable onPress={() => setSaved(!saved)} style={styles.checkRow} accessibilityRole="checkbox" accessibilityState={{ checked: saved }}>
        <View style={[styles.checkbox, saved && styles.checkboxOn]}>{saved ? <Text style={styles.checkMark}>✓</Text> : null}</View>
        <Text style={styles.checkLabel}>I've saved these codes</Text>
      </Pressable>
      <PrimaryButton title="Continue" onPress={onDone} disabled={!saved} />
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 20, fontWeight: "700", color: colors.text, textAlign: "center", marginBottom: 8 },
  body: { fontSize: 14, color: colors.textMuted, textAlign: "center", marginBottom: 18, lineHeight: 20 },
  hint: { fontSize: 12, color: colors.textMuted, textAlign: "center", marginTop: 6 },
  gap: { height: 14 },
  error: { color: colors.danger, marginBottom: 14, textAlign: "center" },
  info: { color: colors.primary, marginBottom: 10, textAlign: "center" },
  link: { paddingVertical: 12, alignItems: "center" },
  linkText: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  linkDisabled: { color: colors.textMuted },
  qrWrap: { alignItems: "center", marginBottom: 12 },
  qr: { width: 200, height: 200 },
  secret: { fontSize: 15, fontWeight: "700", letterSpacing: 1, color: colors.text, textAlign: "center", marginTop: 4, marginBottom: 4 },
  codeBox: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 14, marginBottom: 16, gap: 6, alignItems: "center" },
  recoveryCode: { fontSize: 16, fontWeight: "700", letterSpacing: 2, color: colors.text, fontFamily: "Courier" },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 14, justifyContent: "center" },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: colors.primary, alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: colors.primary },
  checkMark: { color: "#fff", fontWeight: "700" },
  checkLabel: { fontSize: 15, color: colors.text },
});
