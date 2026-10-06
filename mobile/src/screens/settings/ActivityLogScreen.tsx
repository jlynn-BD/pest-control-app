import type { User } from "@pest-app/shared";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as auditApi from "../../api/audit";
import type { ActivityEntry, SignInEvent } from "../../api/audit";
import { ApiError } from "../../api/client";
import { listUsers } from "../../api/users";
import { useAuth } from "../../context/AuthContext";
import { Badge, Card, Field, LoadingView, PrimaryButton, colors } from "../../components/ui";

export type ActivityLogParams = { inspectionId?: string; customerId?: string; propertyId?: string; title?: string } | undefined;
type Props = NativeStackScreenProps<{ ActivityLog: ActivityLogParams }, "ActivityLog">;

const AREAS: { key: string; label: string }[] = [
  { key: "", label: "Everything" },
  { key: "inspections", label: "Inspections" },
  { key: "findings", label: "Findings & photos" },
  { key: "customers", label: "Customers & properties" },
  { key: "reports", label: "Reports & estimates" },
  { key: "team", label: "Team accounts" },
  { key: "templates", label: "Checklist templates" },
];

const SIGN_IN_LABEL: Record<string, string> = {
  LOGIN_SUCCESS: "Signed in",
  LOGIN_PASSWORD_FAILED: "Wrong password",
  MFA_FAILED: "Wrong code",
  LOGIN_LOCKED: "Account locked after too many tries",
  MFA_ENROLLED: "Set up two-step sign-in",
  PASSWORD_CHANGED: "Changed password",
  LOGOUT_ALL: "Signed out of all devices",
  SESSION_REUSE_DETECTED: "Reused session ended (possible copied login)",
};

function messageFor(err: unknown): string {
  return err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong.";
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function prettyField(field: string): string {
  return field.replace(/([A-Z])/g, " $1").toLowerCase();
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleString();
  return String(value);
}

function Detail({ entry }: { entry: ActivityEntry }) {
  const d = entry.details;
  const changes = d?.changes ? Object.entries(d.changes) : [];
  const snapshot = d?.before ?? d?.after;
  const snapshotTitle = d?.before ? "What it contained" : "What was entered";
  const clientGap = entry.clientTime ? Math.abs(new Date(entry.clientTime).getTime() - new Date(entry.createdAt).getTime()) : 0;
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLine}>
        {new Date(entry.createdAt).toLocaleString()} · {entry.actorName}
        {entry.actorRole ? ` (${entry.actorRole.toLowerCase()})` : ""}
      </Text>
      {clientGap > 120000 && entry.clientTime ? <Text style={styles.detailLine}>Done on the device at {new Date(entry.clientTime).toLocaleString()}, sent to the server later.</Text> : null}
      {changes.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>What changed</Text>
          {changes.map(([field, c]) => (
            <Text key={field} style={styles.changeLine}>
              <Text style={styles.field}>{prettyField(field)}: </Text>
              <Text style={styles.old}>{show(c.from)}</Text>
              {"  →  "}
              <Text style={styles.new}>{show(c.to)}</Text>
            </Text>
          ))}
        </View>
      ) : null}
      {changes.length === 0 && snapshot && Object.keys(snapshot).length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>{snapshotTitle}</Text>
          {Object.entries(snapshot).map(([field, v]) => (
            <Text key={field} style={styles.changeLine}>
              <Text style={styles.field}>{prettyField(field)}: </Text>
              {show(v)}
            </Text>
          ))}
        </View>
      ) : null}
      {d?.sketch ? (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>Site map change</Text>
          <Text style={styles.changeLine}>{JSON.stringify(d.sketch)}</Text>
        </View>
      ) : null}
      {entry.userAgent ? <Text style={styles.muted}>{entry.userAgent.slice(0, 90)}</Text> : null}
    </View>
  );
}

// The audit trail: who did what, to which record, and when. Read-only.
export default function ActivityLogScreen({ route, navigation }: Props) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const scoped = route.params ?? {};
  const [tab, setTab] = useState<"activity" | "sign-ins">("activity");
  const [people, setPeople] = useState<User[]>([]);
  const [actorId, setActorId] = useState("");
  const [area, setArea] = useState("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [signIns, setSignIns] = useState<SignInEvent[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    listUsers().then(setPeople).catch(() => {});
  }, []);

  const load = useCallback(
    async (append: boolean, from: string | null) => {
      const ticket = ++requestRef.current;
      setError(null);
      if (append) setLoadingMore(true);
      else {
        setEntries(null);
        setSignIns(null);
      }
      try {
        if (tab === "activity") {
          const page = await auditApi.fetchActivity({
            actorId,
            area,
            q: appliedSearch,
            inspectionId: scoped.inspectionId,
            customerId: scoped.customerId,
            propertyId: scoped.propertyId,
            cursor: append ? from : null,
          });
          if (ticket !== requestRef.current) return;
          setEntries((prev) => (append ? [...(prev ?? []), ...page.items] : page.items));
          setCursor(page.nextCursor);
        } else {
          const page = await auditApi.fetchSignIns(append ? from : null);
          if (ticket !== requestRef.current) return;
          setSignIns((prev) => (append ? [...(prev ?? []), ...page.items] : page.items));
          setCursor(page.nextCursor);
        }
      } catch (err) {
        if (ticket === requestRef.current) setError(messageFor(err));
      } finally {
        if (ticket === requestRef.current) setLoadingMore(false);
      }
    },
    [tab, actorId, area, appliedSearch, scoped.inspectionId, scoped.customerId, scoped.propertyId]
  );

  useEffect(() => {
    load(false, null);
  }, [load]);

  const scopedNote = scoped.inspectionId ? "this inspection" : scoped.customerId ? "this customer" : scoped.propertyId ? "this property" : null;

  let lastDay = "";
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {isAdmin ? (
        <View style={styles.tabs}>
          {(["activity", "sign-ins"] as const).map((t) => (
            <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}>
              <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t === "activity" ? "Activity" : "Sign-ins"}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {tab === "activity" ? (
        <>
          {scopedNote ? (
            <Card style={styles.scopeCard}>
              <Text style={styles.meta}>Showing only activity for {scopedNote}{scoped.title ? ` (${scoped.title})` : ""}.</Text>
              <Text style={styles.link} onPress={() => navigation.setParams({ inspectionId: undefined, customerId: undefined, propertyId: undefined, title: undefined })}>
                Show everything
              </Text>
            </Card>
          ) : null}

          <Text style={styles.filterLabel}>Who</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            <Chip label="Everyone" on={!actorId} onPress={() => setActorId("")} />
            {people.map((p) => (
              <Chip key={p.id} label={`${p.firstName} ${p.lastName}`} on={actorId === p.id} onPress={() => setActorId(p.id)} />
            ))}
          </ScrollView>

          <Text style={styles.filterLabel}>What</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {AREAS.map((a) => (
              <Chip key={a.key} label={a.label} on={area === a.key} onPress={() => setArea(a.key)} />
            ))}
          </ScrollView>

          <Field label="Search (person, customer, address, finding...)" value={search} onChangeText={setSearch} onSubmitEditing={() => setAppliedSearch(search.trim())} returnKeyType="search" autoCapitalize="none" />
          <PrimaryButton title="Search" onPress={() => setAppliedSearch(search.trim())} />
          <View style={styles.gap} />

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {!entries && !error ? <LoadingView label="Loading activity..." /> : null}
          {entries && entries.length === 0 ? <Text style={styles.empty}>No activity matches these filters.</Text> : null}
          {entries?.map((e) => {
            const day = dayLabel(e.createdAt);
            const header = day !== lastDay ? day : null;
            lastDay = day;
            const open = openId === e.id;
            return (
              <View key={e.id}>
                {header ? <Text style={styles.day}>{header}</Text> : null}
                <Pressable onPress={() => setOpenId(open ? null : e.id)} accessibilityRole="button" accessibilityLabel={`${e.actorName} ${e.summary}`}>
                  <Card style={styles.entry}>
                    <View style={styles.entryTop}>
                      <Text style={styles.time}>{timeLabel(e.createdAt)}</Text>
                      <Badge label={e.entityType.replace(/([a-z])([A-Z])/g, "$1 $2")} />
                    </View>
                    <Text style={styles.sentence}>
                      <Text style={styles.actor}>{e.actorName} </Text>
                      {e.summary}
                    </Text>
                    {open ? <Detail entry={e} /> : <Text style={styles.muted}>Tap for details</Text>}
                  </Card>
                </Pressable>
              </View>
            );
          })}
        </>
      ) : (
        <>
          <Text style={styles.meta}>Who signed in, and failed or blocked attempts. The newest are first.</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {!signIns && !error ? <LoadingView label="Loading sign-ins..." /> : null}
          {signIns?.map((s) => (
            <Card key={s.id} style={styles.entry}>
              <View style={styles.entryTop}>
                <Text style={styles.time}>{new Date(s.createdAt).toLocaleString()}</Text>
                <Badge label={s.type === "LOGIN_SUCCESS" ? "OK" : "Check"} tone={s.type === "LOGIN_SUCCESS" || s.type === "MFA_ENROLLED" || s.type === "PASSWORD_CHANGED" ? "success" : "warning"} />
              </View>
              <Text style={styles.sentence}>
                <Text style={styles.actor}>{s.email ?? "Unknown person"} </Text>
                {SIGN_IN_LABEL[s.type] ?? s.type.toLowerCase().replace(/_/g, " ")}
              </Text>
              <Text style={styles.muted}>
                {s.ip ?? "unknown address"}
                {s.userAgent ? ` · ${s.userAgent.slice(0, 70)}` : ""}
              </Text>
            </Card>
          ))}
        </>
      )}

      {cursor ? (
        <View style={styles.more}>
          <PrimaryButton title="Show older" onPress={() => load(true, cursor)} loading={loadingMore} />
        </View>
      ) : null}
    </ScrollView>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  container: { padding: 16, paddingBottom: 48 },
  tabs: { flexDirection: "row", gap: 8, marginBottom: 14 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: "center" },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { fontWeight: "600", color: colors.text },
  tabTextOn: { color: "#fff" },
  scopeCard: { marginBottom: 12, gap: 6 },
  link: { color: colors.primary, fontWeight: "600" },
  filterLabel: { fontSize: 13, color: colors.textMuted, fontWeight: "500", marginBottom: 6, marginTop: 4 },
  chipRow: { gap: 8, paddingBottom: 10 },
  chip: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 18, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.text, fontWeight: "600" },
  chipTextOn: { color: "#fff" },
  gap: { height: 8 },
  day: { fontSize: 14, fontWeight: "700", color: colors.text, marginTop: 14, marginBottom: 8 },
  entry: { marginBottom: 8, gap: 4 },
  entryTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  time: { fontSize: 12, color: colors.textMuted },
  sentence: { fontSize: 15, color: colors.text, lineHeight: 21 },
  actor: { fontWeight: "700" },
  muted: { fontSize: 12, color: colors.textMuted },
  meta: { fontSize: 13, color: colors.textMuted, marginBottom: 10 },
  detail: { marginTop: 6, gap: 6, borderTopColor: colors.border, borderTopWidth: 1, paddingTop: 8 },
  detailLine: { fontSize: 12, color: colors.textMuted },
  block: { gap: 3 },
  blockTitle: { fontSize: 12, fontWeight: "700", color: colors.text, textTransform: "uppercase", letterSpacing: 0.5 },
  changeLine: { fontSize: 13, color: colors.text, lineHeight: 19 },
  field: { fontWeight: "600" },
  old: { color: colors.danger, textDecorationLine: "line-through" },
  new: { color: colors.primary, fontWeight: "600" },
  error: { color: colors.danger, textAlign: "center", marginVertical: 10 },
  empty: { color: colors.textMuted, textAlign: "center", marginVertical: 24 },
  more: { marginTop: 14 },
});
