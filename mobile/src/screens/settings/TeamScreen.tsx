import type { User } from "@pest-app/shared";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError } from "../../api/client";
import * as usersApi from "../../api/users";
import type { Role } from "../../api/users";
import { useAuth } from "../../context/AuthContext";
import { Badge, Card, Field, LoadingView, PrimaryButton, colors } from "../../components/ui";

const ROLES: { value: Role; label: string }[] = [
  { value: "TECHNICIAN", label: "Technician" },
  { value: "OFFICE", label: "Office" },
  { value: "ADMIN", label: "Admin" },
];

function messageFor(err: unknown): string {
  return err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong.";
}

function isLocked(u: User): boolean {
  return Boolean(u.lockedUntil && new Date(u.lockedUntil) > new Date());
}

// Admin-only: how people get an account, and how it's maintained. There is no
// self-signup - an admin adds each person, hands them a one-time temporary
// password, and the person chooses their own password and sets up two-step
// sign-in the first time they sign in.
export default function TeamScreen() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>("TECHNICIAN");
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: "deactivate" | "reset-mfa" | "reset-password" } | null>(null);
  // A temporary password is shown exactly once, here, and then dropped.
  const [secret, setSecret] = useState<{ name: string; password: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await usersApi.listUsers());
      setError(null);
    } catch (err) {
      setError(messageFor(err));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function handleAdd() {
    setSecret(null);
    await run(async () => {
      const res = await usersApi.createUser({ firstName, lastName, email, role, phone: phone.trim() || undefined });
      setSecret({ name: `${res.user.firstName} ${res.user.lastName}`, password: res.temporaryPassword });
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      setRole("TECHNICIAN");
      setAdding(false);
    });
  }

  // The seeded sample accounts (@pestapp.dev) share a known password; they exist
  // so the app can be demoed, and should be switched off once real accounts exist.
  const demoAccounts = (users ?? []).filter((u) => u.active && u.email.toLowerCase().endsWith("@pestapp.dev"));

  if (!users) return error ? <Text style={styles.error}>{error}</Text> : <LoadingView label="Loading team..." />;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      {secret ? (
        <Card style={styles.secretCard}>
          <Text style={styles.cardTitle}>Temporary password for {secret.name}</Text>
          <Text selectable style={styles.secret}>
            {secret.password}
          </Text>
          <Text style={styles.meta}>
            This is shown once and can't be looked up later. Give it to them privately (in person or a direct message). At their first sign-in they'll choose their own password and set up two-step sign-in.
          </Text>
          <View style={styles.spacerSmall} />
          <PrimaryButton title="Done" onPress={() => setSecret(null)} />
        </Card>
      ) : null}

      {demoAccounts.length > 0 ? (
        <Card style={styles.warnCard}>
          <Text style={styles.cardTitle}>Shared demo logins are still on</Text>
          <Text style={styles.meta}>
            {demoAccounts.map((d) => d.email).join(", ")} use a password that is published in the project. Once everyone has their own account, turn these off below ("Turn off access") so nobody can sign in with them.
          </Text>
        </Card>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {adding ? (
        <Card style={styles.formCard}>
          <Text style={styles.cardTitle}>Add a person</Text>
          <Field label="First name" value={firstName} onChangeText={setFirstName} autoCapitalize="words" />
          <Field label="Last name" value={lastName} onChangeText={setLastName} autoCapitalize="words" />
          <Field label="Email (their login)" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
          <Field label="Mobile number (for text-message codes, optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="555-123-4567" />
          <Text style={styles.fieldLabel}>Role</Text>
          <View style={styles.chipRow}>
            {ROLES.map((r) => (
              <Pressable key={r.value} onPress={() => setRole(r.value)} style={[styles.chip, role === r.value && styles.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: role === r.value }}>
                <Text style={[styles.chipText, role === r.value && styles.chipTextOn]}>{r.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.row}>
            <View style={styles.half}>
              <PrimaryButton title="Create account" onPress={handleAdd} loading={busy} disabled={!firstName.trim() || !lastName.trim() || !email.trim()} />
            </View>
            <View style={styles.half}>
              <PrimaryButton title="Cancel" onPress={() => setAdding(false)} />
            </View>
          </View>
        </Card>
      ) : (
        <PrimaryButton title="+ Add a person" onPress={() => { setSecret(null); setAdding(true); }} />
      )}

      <Text style={styles.sectionTitle}>People ({users.length})</Text>
      {users.map((u) => {
        const isMe = u.id === me?.id;
        const open = expandedId === u.id;
        return (
          <Card key={u.id} style={[styles.userCard, !u.active && styles.inactive]}>
            <Pressable onPress={() => setExpandedId(open ? null : u.id)} accessibilityRole="button" accessibilityLabel={`${u.firstName} ${u.lastName}`}>
              <View style={styles.row}>
                <View style={styles.flex}>
                  <Text style={styles.name}>
                    {u.firstName} {u.lastName}
                    {isMe ? " (you)" : ""}
                  </Text>
                  <Text style={styles.meta}>{u.email}</Text>
                </View>
                <Badge label={u.role} />
              </View>
              <View style={styles.badges}>
                {!u.active ? <Badge label="Turned off" tone="danger" /> : null}
                {u.active && !u.mfaMethod ? <Badge label="Two-step not set up" tone="warning" /> : null}
                {u.mfaMethod === "TOTP" ? <Badge label="Authenticator app" tone="success" /> : null}
                {u.mfaMethod === "SMS" ? <Badge label="Text message" tone="success" /> : null}
                {u.mustChangePassword ? <Badge label="Hasn't signed in yet" tone="warning" /> : null}
                {isLocked(u) ? <Badge label="Locked" tone="danger" /> : null}
              </View>
              <Text style={styles.meta}>{u.lastLoginAt ? `Last signed in ${new Date(u.lastLoginAt).toLocaleString()}` : "Never signed in"}</Text>
            </Pressable>

            {open ? (
              <View style={styles.actions}>
                <Text style={styles.fieldLabel}>Role</Text>
                <View style={styles.chipRow}>
                  {ROLES.map((r) => (
                    <Pressable
                      key={r.value}
                      disabled={busy || isMe}
                      onPress={() => run(async () => void (await usersApi.updateUser(u.id, { role: r.value })))}
                      style={[styles.chip, u.role === r.value && styles.chipOn, isMe && styles.chipDisabled]}
                    >
                      <Text style={[styles.chipText, u.role === r.value && styles.chipTextOn]}>{r.label}</Text>
                    </Pressable>
                  ))}
                </View>

                {confirm?.id === u.id ? (
                  <View>
                    <Text style={styles.meta}>
                      {confirm.action === "deactivate"
                        ? `Turn off ${u.firstName}'s access? They're signed out everywhere right away. Their past work stays in the app.`
                        : confirm.action === "reset-mfa"
                          ? `Reset ${u.firstName}'s two-step sign-in? They're signed out everywhere and must set it up again at their next sign-in.`
                          : `Give ${u.firstName} a new temporary password? Their current password stops working and they're signed out everywhere.`}
                    </Text>
                    <View style={styles.row}>
                      <View style={styles.half}>
                        <PrimaryButton
                          title="Yes"
                          loading={busy}
                          onPress={() =>
                            run(async () => {
                              if (confirm.action === "deactivate") await usersApi.updateUser(u.id, { active: false });
                              else if (confirm.action === "reset-mfa") await usersApi.resetUserMfa(u.id);
                              else {
                                const res = await usersApi.resetUserPassword(u.id);
                                setSecret({ name: `${u.firstName} ${u.lastName}`, password: res.temporaryPassword });
                              }
                            })
                          }
                        />
                      </View>
                      <View style={styles.half}>
                        <PrimaryButton title="Cancel" onPress={() => setConfirm(null)} />
                      </View>
                    </View>
                  </View>
                ) : (
                  <View style={styles.actionStack}>
                    {isLocked(u) ? <PrimaryButton title="Unlock account" onPress={() => run(() => usersApi.unlockUser(u.id))} disabled={busy} /> : null}
                    <PrimaryButton title="New temporary password" onPress={() => setConfirm({ id: u.id, action: "reset-password" })} disabled={busy} />
                    <PrimaryButton title="Reset two-step sign-in" onPress={() => setConfirm({ id: u.id, action: "reset-mfa" })} disabled={busy} />
                    {u.active ? (
                      isMe ? null : <PrimaryButton title="Turn off access" onPress={() => setConfirm({ id: u.id, action: "deactivate" })} disabled={busy} />
                    ) : (
                      <PrimaryButton title="Turn access back on" onPress={() => run(async () => void (await usersApi.updateUser(u.id, { active: true })))} disabled={busy} />
                    )}
                  </View>
                )}
              </View>
            ) : null}
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  container: { padding: 16, paddingBottom: 40, gap: 4 },
  flex: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  half: { flex: 1 },
  error: { color: colors.danger, marginVertical: 10, textAlign: "center" },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 20, marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: 8 },
  warnCard: { marginBottom: 12, borderColor: colors.danger, borderWidth: 1 },
  secretCard: { marginBottom: 12, borderColor: colors.warning, borderWidth: 1 },
  secret: { fontSize: 22, fontWeight: "700", letterSpacing: 1, color: colors.text, marginVertical: 10, fontFamily: "Courier" },
  formCard: { gap: 2 },
  fieldLabel: { fontSize: 13, color: colors.textMuted, fontWeight: "500", marginBottom: 6 },
  chipRow: { flexDirection: "row", gap: 8, marginBottom: 14, flexWrap: "wrap" },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipDisabled: { opacity: 0.5 },
  chipText: { fontSize: 14, color: colors.text, fontWeight: "600" },
  chipTextOn: { color: "#fff" },
  userCard: { marginBottom: 10, gap: 6 },
  inactive: { opacity: 0.6 },
  name: { fontSize: 16, fontWeight: "700", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  badges: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginVertical: 6 },
  actions: { borderTopColor: colors.border, borderTopWidth: 1, marginTop: 8, paddingTop: 12 },
  actionStack: { gap: 8 },
  spacerSmall: { height: 10 },
});
