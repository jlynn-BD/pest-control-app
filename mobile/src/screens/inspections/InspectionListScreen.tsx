import { useFocusEffect } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import React, { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { listInspections } from "../../api/inspections";
import { listLocalInspections, LocalInspectionListItem } from "../../db/inspectionStore";
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

export default function InspectionListScreen({ navigation }: Props) {
  const { user } = useAuth();
  const [localRows, setLocalRows] = useState<LocalInspectionListItem[]>([]);

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

  return (
    <View style={styles.container}>
      <Pressable style={styles.addButton} onPress={() => navigation.navigate("NewInspection")}>
        <Text style={styles.addButtonText}>+ New Inspection</Text>
      </Pressable>

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
          data={rows}
          keyExtractor={(item) => item.id}
          refreshing={isRefetching}
          onRefresh={refetch}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() =>
                item.kind === "local"
                  ? navigation.navigate("LocalInspectionDetail", { inspectionId: item.id })
                  : navigation.navigate("InspectionDetail", { inspectionId: item.id })
              }
            >
              <View style={styles.rowMain}>
                <Text style={styles.customer}>{item.customerName}</Text>
                <Text style={styles.meta}>{item.propertyAddress}</Text>
                <Text style={styles.meta}>{new Date(item.createdAt).toLocaleDateString()}</Text>
              </View>
              <View style={styles.badgeCol}>
                <Badge label={item.status.replace(/_/g, " ")} tone={STATUS_TONE[item.status] ?? "default"} />
                {!item.synced ? <Badge label="Not synced" tone="warning" /> : null}
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16, paddingTop: 12 },
  addButton: { alignSelf: "flex-start", marginBottom: 12 },
  addButtonText: { color: colors.primary, fontWeight: "600", fontSize: 15 },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 16, fontWeight: "600", color: colors.text },
  list: { gap: 10, paddingBottom: 24 },
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
