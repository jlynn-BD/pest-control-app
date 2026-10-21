import type { User } from "@pest-app/shared";
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import * as authApi from "../api/auth";
import { ApiError } from "../api/client";
import {
  createPasskey,
  deviceLabel,
  dismissEasySignIn,
  hasPasskeyHint,
  PasskeyCancelled,
  passkeysSupported,
  platformAuthenticatorAvailable,
  rememberPasskeyOnThisDevice,
} from "../lib/passkey";
import { Card, Field, PrimaryButton, colors } from "./ui";

type Me = User & { smsAvailable?: boolean };

function message(err: unknown): string {
  return err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong. Please try again.";
}

// Two ways to skip typing a password: Face ID (or fingerprint / screen lock) on
// this device, and a texted code. Used in Settings, and - as `compact` - as a
// one-time offer on the home screen after signing in.
export function EasySignInCard({ compact = false, onDismiss }: { compact?: boolean; onDismiss?: () => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [passkeys, setPasskeys] = useState<authApi.PasskeyInfo[]>([]);
  const [faceOk, setFaceOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // text sign-in: phone -> code
  const [phone, setPhone] = useState("");
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [maskedPhone, setMaskedPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const load = useCallback(async () => {
    try {
      const [who, list] = await Promise.all([authApi.fetchMe() as Promise<Me>, authApi.listPasskeys().catch(() => [])]);
      setMe(who);
      setPasskeys(list);
      // The "this device has Face ID" hint is only a convenience for the sign-in
      // screen; keep it in step with the truth.
      if (list.length === 0) rememberPasskeyOnThisDevice(false);
    } catch {
      /* offline: the card just doesn't show */
    }
  }, []);

  useEffect(() => {
    load();
    platformAuthenticatorAvailable().then(setFaceOk);
  }, [load]);

  const showFace = passkeysSupported() && faceOk;
  const faceOnHere = hasPasskeyHint() && passkeys.length > 0;
  const textAvailable = Boolean(me?.smsAvailable);
  const textOn = Boolean(me?.phoneVerified);

  // Nothing to offer (e.g. an unsupported browser, texts not set up): stay out of the way.
  if (compact && me && !((showFace && !faceOnHere) || (textAvailable && !textOn))) return null;
  if (!me) return null;

  async function turnOnFaceId() {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const { options, challengeId } = await authApi.passkeyRegisterOptions();
      const response = await createPasskey(options);
      await authApi.passkeyRegisterVerify(challengeId, response, deviceLabel());
      rememberPasskeyOnThisDevice(true);
      setInfo("Face ID is on. Next time, tap \"Sign in with Face ID\" on the sign-in screen.");
      await load();
    } catch (err) {
      if (!(err instanceof PasskeyCancelled)) setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function removePasskey(id: string) {
    setError(null);
    setBusy(true);
    try {
      await authApi.deletePasskey(id);
      await load();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    if (phone.replace(/\D/g, "").length < 10) {
      setError("Enter your 10-digit mobile number.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await authApi.startPhoneVerification(phone);
      setChallengeToken(res.challengeToken);
      setMaskedPhone(res.maskedPhone);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode() {
    if (!challengeToken) return;
    if (code.replace(/\s/g, "").length !== 6) {
      setError("Enter the 6-digit code.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await authApi.confirmPhoneVerification(challengeToken, code);
      setChallengeToken(null);
      setCode("");
      setInfo("Texted codes are on for your phone.");
      await load();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{compact ? "Skip the password" : "Easier sign-in"}</Text>
      <Text style={styles.body}>No more passwords to remember: sign in with Face ID, or with your email and a code we send you.</Text>

      {showFace ? (
        <View style={styles.block}>
          <Text style={styles.label}>Face ID on this device</Text>
          {passkeys.map((p) => (
            <View key={p.id} style={styles.deviceRow}>
              <Text style={styles.deviceText}>
                ✓ {p.deviceName ?? "A device"} · added {new Date(p.createdAt).toLocaleDateString()}
                {p.lastUsedAt ? ` · last used ${new Date(p.lastUsedAt).toLocaleDateString()}` : ""}
              </Text>
              {!compact ? (
                <Text style={styles.remove} onPress={() => removePasskey(p.id)}>
                  Remove
                </Text>
              ) : null}
            </View>
          ))}
          {!faceOnHere ? <PrimaryButton title="Turn on Face ID" onPress={turnOnFaceId} loading={busy} /> : null}
        </View>
      ) : null}

      {textAvailable ? (
        <View style={styles.block}>
          <Text style={styles.label}>Texted codes (optional)</Text>
          {textOn ? (
            <Text style={styles.deviceText}>✓ On{me.phone ? ` · ${me.phone}` : ""}</Text>
          ) : challengeToken ? (
            <>
              <Text style={styles.body}>We texted a code to {maskedPhone}. Enter it to turn this on.</Text>
              <Field
                label="6-digit code"
                value={code}
                onChangeText={(t) => setCode(t.replace(/[^0-9 ]/g, ""))}
                keyboardType="number-pad"
                inputMode="numeric"
                maxLength={7}
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
              />
              <PrimaryButton title="Confirm" onPress={confirmCode} loading={busy} />
            </>
          ) : (
            <>
              <Field label="Your mobile number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="555-123-4567" />
              <PrimaryButton title="Text me a code" onPress={sendCode} loading={busy} />
            </>
          )}
        </View>
      ) : !compact ? (
        <Text style={styles.muted}>Texted codes aren't switched on yet. Signing in with a code emailed to you already works.</Text>
      ) : null}

      {info ? <Text style={styles.info}>{info}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {compact ? (
        <Text
          style={styles.remove}
          onPress={() => {
            dismissEasySignIn();
            onDismiss?.();
          }}
        >
          Not now
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8 },
  title: { fontSize: 16, fontWeight: "700", color: colors.text },
  body: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  block: { marginTop: 8, gap: 8 },
  label: { fontSize: 13, fontWeight: "700", color: colors.text },
  deviceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  deviceText: { fontSize: 13, color: colors.text, flex: 1 },
  remove: { color: colors.primary, fontWeight: "600", fontSize: 13, paddingVertical: 8 },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 6 },
  info: { color: colors.primary, fontSize: 13, marginTop: 6 },
  error: { color: colors.danger, fontSize: 13, marginTop: 6 },
});
