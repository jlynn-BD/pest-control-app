import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../context/AuthContext";
import {
  LocalSyncConflict,
  listSyncConflicts,
  resolveSyncConflictKeepLocal,
  resolveSyncConflictUseServer,
} from "../../db/inspectionStore";
import { getPendingSyncCount, runSync, SyncResult } from "../../sync/syncEngine";
import { Badge, Card, PrimaryButton, colors } from "../../components/ui";

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [conflicts, setConflicts] = useState<LocalSyncConflict[]>([]);
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);

  const refreshPendingCount = useCallback(() => {
    setPendingCount(getPendingSyncCount());
    setConflicts(listSyncConflicts());
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshPendingCount();
    }, [refreshPendingCount])
  );

  async function handleSyncNow() {
    setSyncing(true);
    const result = await runSync();
    setLastResult(result);
    setLastSyncAt(new Date());
    refreshPendingCount();
    setSyncing(false);
  }

  // Resolving just decides which copy wins locally - "Keep mine" re-stamps
  // this device's edit as newest so the next push actually lands instead of
  // conflicting again; "Use theirs" adopts the other device's edit. Either
  // way a fresh sync is kicked off right after so the choice takes effect
  // immediately rather than waiting for the next automatic trigger.
  async function handleResolve(conflict: LocalSyncConflict, keepLocal: boolean) {
    const key = `${conflict.entity}:${conflict.localId}`;
    setResolvingKey(key);
    if (keepLocal) {
      resolveSyncConflictKeepLocal(conflict.entity, conflict.localId);
    } else {
      resolveSyncConflictUseServer(conflict.entity, conflict.localId);
    }
    refreshPendingCount();
    const result = await runSync();
    setLastResult(result);
    setLastSyncAt(new Date());
    refreshPendingCount();
    setResolvingKey(null);
  }

  return (
    <View style={styles.container}>
      <Card>
        <Text style={styles.name}>
          {user?.firstName} {user?.lastName}
        </Text>
        <Text style={styles.meta}>{user?.email}</Text>
        <Text style={styles.meta}>{user?.role}</Text>
      </Card>

      <Text style={styles.sectionTitle}>Sync</Text>
      <Card style={styles.syncCard}>
        <View style={styles.syncRow}>
          <Text style={styles.syncLabel}>Pending changes</Text>
          <Badge label={String(pendingCount)} tone={pendingCount > 0 ? "warning" : "success"} />
        </View>
        {lastSyncAt ? (
          <Text style={styles.meta}>Last synced {lastSyncAt.toLocaleTimeString()}</Text>
        ) : (
          <Text style={styles.meta}>Not synced yet this session</Text>
        )}
        {lastResult ? (
          lastResult.error ? (
            <Text style={styles.errorText}>Sync failed: {lastResult.error}</Text>
          ) : (
            <Text style={styles.meta}>
              Pushed {lastResult.pushed}, uploaded {lastResult.uploaded}
              {lastResult.conflicts > 0 ? `, ${lastResult.conflicts} conflict(s)` : ""}
            </Text>
          )
        ) : null}
        <View style={styles.spacerSmall} />
        <PrimaryButton title="Sync now" onPress={handleSyncNow} loading={syncing} />
      </Card>

      {conflicts.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Sync issues ({conflicts.length})</Text>
          <Text style={styles.meta}>
            Another device saved a newer change to these before this device's edit could sync. Pick which version to keep.
          </Text>
          {conflicts.map((c) => {
            const key = `${c.entity}:${c.localId}`;
            const busy = resolvingKey === key;
            return (
              <Card key={key} style={styles.syncCard}>
                <Text style={styles.syncLabel}>{c.label}</Text>
                <Text style={styles.meta}>Detected {new Date(c.detectedAt).toLocaleString()}</Text>
                <View style={styles.spacerSmall} />
                <View style={styles.buttonRow}>
                  <View style={styles.buttonHalf}>
                    <PrimaryButton title="Keep mine" onPress={() => handleResolve(c, true)} loading={busy} disabled={resolvingKey !== null && !busy} />
                  </View>
                  <View style={styles.buttonHalf}>
                    <PrimaryButton title="Use theirs" onPress={() => handleResolve(c, false)} loading={busy} disabled={resolvingKey !== null && !busy} />
                  </View>
                </View>
              </Card>
            );
          })}
        </>
      ) : null}

      <View style={styles.spacer} />
      <PrimaryButton title="Log out" onPress={logout} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 16 },
  name: { fontSize: 18, fontWeight: "700", color: colors.text },
  meta: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  sectionTitle: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 20, marginBottom: 8 },
  syncCard: { gap: 4 },
  syncRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  syncLabel: { fontSize: 15, fontWeight: "600", color: colors.text },
  errorText: { color: colors.danger, fontSize: 13, marginTop: 2 },
  spacerSmall: { height: 10 },
  spacer: { height: 20 },
  buttonRow: { flexDirection: "row", gap: 10 },
  buttonHalf: { flex: 1 },
});
