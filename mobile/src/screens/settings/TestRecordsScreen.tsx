import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ApiError } from "../../api/client";
import * as propertiesApi from "../../api/properties";
import type { RemovalListEntry } from "../../api/properties";
import { primeCache } from "../../db/cache";
import { runSync } from "../../sync/syncEngine";
import { Card, Field, LoadingView, PrimaryButton, colors, fonts } from "../../components/ui";

function messageFor(err: unknown): string {
  return err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong.";
}

// Admin only: take test addresses out of the system. Nothing is guessed - the
// admin ticks exactly the addresses to remove, sees what will go with them, and
// types DELETE to confirm. Records are marked deleted (not erased from the
// database) and every removal is written to the activity log.
export default function TestRecordsScreen() {
  const [list, setList] = useState<RemovalListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [alsoCustomers, setAlsoCustomers] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await propertiesApi.getRemovalList());
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

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!list) return [];
    if (!q) return list;
    return list.filter((p) => `${p.addressLine1} ${p.city} ${p.customerName}`.toLowerCase().includes(q));
  }, [list, search]);

  const chosen = (list ?? []).filter((p) => picked.has(p.id));
  const inspectionTotal = chosen.reduce((n, p) => n + p.inspectionCount, 0);
  const completedTotal = chosen.reduce((n, p) => n + p.completedCount, 0);

  function toggle(id: string) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirming(false);
    setTyped("");
    setDone(null);
  }

  async function handleRemove() {
    if (typed.trim().toUpperCase() !== "DELETE" || chosen.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await propertiesApi.removeProperties(chosen.map((p) => p.id), alsoCustomers);
      setDone(
        `Removed ${result.properties} address(es), ${result.inspections} inspection(s)` +
          (result.customers ? ` and ${result.customers} customer(s)` : "") +
          ". They disappear from other devices the next time those sync."
      );
      setPicked(new Set());
      setConfirming(false);
      setTyped("");
      await load();
      // Refresh this device too, so the removed addresses leave its lists now.
      runSync().then(() => primeCache()).catch(() => {});
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  if (!list && !error) return <LoadingView />;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.meta}>
        Tick the test addresses to remove. Each one is removed together with its inspections and bookings. Real customers' addresses stay unless you tick them, so check the list carefully.
      </Text>
      <View style={styles.gap} />
      <Field label="Find an address or customer" value={search} onChangeText={setSearch} placeholder="Type to filter" autoCapitalize="none" />

      {done ? <Text style={styles.success}>{done}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {shown.map((p) => {
        const on = picked.has(p.id);
        return (
          <Pressable key={p.id} onPress={() => toggle(p.id)} style={[styles.row, on && styles.rowOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
            <View style={[styles.box, on && styles.boxOn]}>{on ? <Text style={styles.tick}>✓</Text> : null}</View>
            <View style={styles.rowText}>
              <Text style={styles.addr}>{p.addressLine1}</Text>
              <Text style={styles.sub}>
                {p.city}, {p.state} · {p.customerName}
              </Text>
              <Text style={styles.sub}>
                {p.inspectionCount === 0 ? "No inspections" : `${p.inspectionCount} inspection(s), ${p.completedCount} completed`}
              </Text>
            </View>
          </Pressable>
        );
      })}
      {list && shown.length === 0 ? <Text style={styles.meta}>No addresses match.</Text> : null}

      {chosen.length > 0 ? (
        <Card style={styles.actionCard}>
          <Text style={styles.title}>{chosen.length} address(es) selected</Text>
          <Text style={styles.meta}>
            That removes {inspectionTotal} inspection(s)
            {completedTotal > 0 ? `, including ${completedTotal} completed report(s)` : ""}, and any bookings at these addresses.
          </Text>
          <Pressable onPress={() => setAlsoCustomers((v) => !v)} style={styles.optionRow} accessibilityRole="checkbox" accessibilityState={{ checked: alsoCustomers }}>
            <View style={[styles.box, alsoCustomers && styles.boxOn]}>{alsoCustomers ? <Text style={styles.tick}>✓</Text> : null}</View>
            <Text style={styles.optionText}>Also remove the customer when none of their other addresses is left</Text>
          </Pressable>
          {confirming ? (
            <>
              <Text style={styles.warn}>This can't be undone from the app. Type DELETE to confirm.</Text>
              <Field label="Type DELETE" value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} />
              <View style={styles.buttonRow}>
                <View style={styles.buttonHalf}>
                  <PrimaryButton title="Delete them" onPress={handleRemove} disabled={typed.trim().toUpperCase() !== "DELETE"} loading={busy} />
                </View>
                <View style={styles.buttonHalf}>
                  <PrimaryButton title="Cancel" onPress={() => { setConfirming(false); setTyped(""); }} disabled={busy} />
                </View>
              </View>
            </>
          ) : (
            <PrimaryButton title={`Delete ${chosen.length} selected`} onPress={() => setConfirming(true)} />
          )}
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  container: { padding: 16, paddingBottom: 60 },
  meta: { fontSize: 14, color: colors.textMuted },
  gap: { height: 12 },
  error: { color: colors.danger, marginTop: 10 },
  success: { color: colors.success, marginTop: 10, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  rowOn: { borderColor: colors.danger, backgroundColor: "#FBEDEA" },
  rowText: { flex: 1 },
  addr: { fontSize: 15, fontWeight: "700", color: colors.text },
  sub: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.card },
  boxOn: { backgroundColor: colors.danger, borderColor: colors.danger },
  tick: { color: "#fff", fontWeight: "800", fontSize: 14 },
  actionCard: { marginTop: 16, gap: 10, borderColor: colors.danger, borderWidth: 1.5 },
  title: { fontFamily: fonts.display, fontSize: 16, fontWeight: "700", color: colors.text },
  optionRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  optionText: { flex: 1, fontSize: 14, color: colors.text },
  warn: { color: colors.danger, fontWeight: "700" },
  buttonRow: { flexDirection: "row", gap: 10 },
  buttonHalf: { flex: 1 },
});
