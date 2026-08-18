import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../context/AuthContext";
import { getPendingSyncCount, runSync, SyncResult } from "../../sync/syncEngine";
import { Badge, Card, PrimaryButton, colors } from "../../components/ui";

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);

  const refreshPendingCount = useCallback(() => {
    setPendingCount(getPendingSyncCount());
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
});
