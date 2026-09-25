import { useFocusEffect } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { listInspections } from "../../api/inspections";
import { ensureLocalInspection } from "../../lib/resumeInspection";
import {
  deleteLocalInspection,
  listLocalInspections,
  LocalInspectionListItem,
} from "../../db/inspectionStore";
import { useAuth } from "../../context/AuthContext";
import { InspectionsStackParamList } from "../../navigation/navigationTypes";
import { Badge, ErrorView, LoadingView, colors } from "../../components/ui";

type Props = NativeStackScreenProps<InspectionsStackParamList, "InspectionList">;

const STATUS_TONE: Record<string, "default" | "warning" | "success"> = {
  SCHEDULED: "default",
  IN_PROGRESS: "warning",
  COMPLETED: "success",
  CANCELED: "default",
};

type Row = {
  kind: "remote" | "local";
  id: string;
  customerName: string;
  propertyAddress: string;
  status: string;
  createdAt: string;
  synced: boolean;
};

type Header = { kind: "header"; id: string; title: string };
type ListItem = Row | Header;

export default function InspectionListScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [localRows, setLocalRows] = useState<LocalInspectionListItem[]>([]);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (user) setLocalRows(listLocalInspections(user.id));
    }, [user])
  );

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["inspections", user?.id],
    queryFn: () => listInspections({ technicianId: user!.id }),
    enabled: !!user,
    retry: false,
  });

  // A local row that already made it to the server (syncStatus "synced") but
  // no longer appears in a successful remote fetch was deleted server-side
  // by someone/something else - the local copy is a stale ghost with no
  // further syncing to do, so prune it here rather than showing it forever.
  // A "pending" row is left alone even if absent remotely: that's just an
  // unsynced local inspection that hasn't had a chance to reach the server.
  useEffect(() => {
    if (!user || !data) return;
    const remoteIds = new Set(data.map((r) => r.id));
    const current = listLocalInspections(user.id);
    const staleIds = current.filter((r) => r.syncStatus === "synced" && !remoteIds.has(r.id)).map((r) => r.id);
    if (staleIds.length === 0) return;
    for (const id of staleIds) deleteLocalInspection(id);
    setLocalRows(listLocalInspections(user.id));
  }, [data, user]);

  const localRowIds = new Set(localRows.map((r) => r.id));
  const rows: Row[] = [
    ...localRows.map((r): Row => ({
      kind: "local",
      id: r.id,
      customerName: r.customerName,
      propertyAddress: r.propertyAddress,
      status: r.status,
      createdAt: r.createdAt,
      synced: r.syncStatus === "synced",
    })),
    ...(data ?? [])
      .filter((r) => !localRowIds.has(r.id))
      .map((r): Row => ({
        kind: "remote",
        id: r.id,
        customerName: r.customer.name,
        propertyAddress: r.property.addressLine1,
        status: r.status,
        createdAt: r.createdAt,
        synced: true,
      })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  // Two inspections for the same customer (one finished, one still going)
  // looked like a duplicate account when listed together. Splitting into
  // "In progress" / "Completed" sections makes it obvious which one is the
  // active visit to continue and which is history.
  const inProgressRows = rows.filter((r) => r.status !== "COMPLETED");
  const completedRows = rows.filter((r) => r.status === "COMPLETED");
  const listItems: ListItem[] = [
    ...(inProgressRows.length > 0 ? [{ kind: "header" as const, id: "h-progress", title: `In progress (${inProgressRows.length})` }] : []),
    ...inProgressRows,
    ...(completedRows.length > 0 ? [{ kind: "header" as const, id: "h-completed", title: `Completed (${completedRows.length})` }] : []),
    ...completedRows,
  ];

  return (
    <View style={styles.container}>
      <Pressable style={styles.addButton} onPress={() => navigation.navigate("NewInspection")}>
        <Text style={styles.addButtonText}>+ New Inspection</Text>
      </Pressable>

      {openError ? <Text style={styles.openError}>{openError}</Text> : null}
      {isLoading && localRows.length === 0 ? (
        <LoadingView />
      ) : isError && rows.length === 0 ? (
        <ErrorView message="Failed to load inspections" />
      ) : rows.length === 0 ? (
        <View style={styles.centerFill}>
          <Text style={styles.emptyTitle}>No inspections yet</Text>
        </View>
      ) : (
        <FlatList
          data={listItems}
          keyExtractor={(item) => item.id}
          refreshing={isRefetching}
          onRefresh={refetch}
          contentContainerStyle={styles.list}
          renderItem={({ item }) =>
            item.kind === "header" ? (
              <Text style={styles.sectionHeader}>{item.title}</Text>
            ) : (
            <Pressable
              style={styles.row}
              onPress={async () => {
                if (item.kind === "remote" && item.status === "IN_PROGRESS") {
                  // Exists only server-side (e.g. started on another device) -
                  // pull it into local storage so it opens in the editable
                  // workspace and can be continued, not the read-only view.
                  if (openingId) return;
                  setOpeningId(item.id);
                  setOpenError(null);
                  try {
                    await ensureLocalInspection(item.id);
                    navigation.navigate("InspectionWorkspace", { inspectionId: item.id });
                  } catch {
                    setOpenError("Couldn't open this inspection - check your connection and try again.");
                  } finally {
                    setOpeningId(null);
                  }
                  return;
                }
                if (item.kind === "local" && item.status !== "COMPLETED") {
                  // Unfinished - drop back into the editable workspace
                  // (checklist, findings, signatures, etc.) instead of the
                  // read-only summary, so leaving mid-inspection and coming
                  // back later actually lets you continue it.
                  navigation.navigate("InspectionWorkspace", { inspectionId: item.id });
                } else if (item.kind === "local") {
                  navigation.navigate("LocalInspectionDetail", { inspectionId: item.id });
                } else {
                  navigation.navigate("InspectionDetail", { inspectionId: item.id });
                }
              }}
            >
              <View style={styles.rowMain}>
                <Text style={styles.customer}>{item.customerName}</Text>
                <Text style={styles.meta}>{item.propertyAddress}</Text>
                <Text style={styles.meta}>{new Date(item.createdAt).toLocaleDateString()}</Text>
              </View>
              <View style={styles.badgeCol}>
                <Badge label={item.status.replace(/_/g, " ")} tone={STATUS_TONE[item.status] ?? "default"} />
                {!item.synced ? <Badge label="Not synced" tone="warning" /> : null}
                {openingId === item.id ? <Text style={styles.meta}>Opening…</Text> : null}
              </View>
            </Pressable>
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16, paddingTop: 12 },
  addButton: { alignSelf: "flex-start", paddingVertical: 12, marginBottom: 4 },
  addButtonText: { color: colors.primary, fontWeight: "600", fontSize: 15 },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  list: { gap: 10, paddingBottom: 24 },
  sectionHeader: { fontSize: 13, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", marginTop: 6 },
  openError: { color: colors.danger, fontSize: 13, marginBottom: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  rowMain: { flex: 1 },
  badgeCol: { gap: 6, alignItems: "flex-end" },
  customer: { fontSize: 16, fontWeight: "600", color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
});
